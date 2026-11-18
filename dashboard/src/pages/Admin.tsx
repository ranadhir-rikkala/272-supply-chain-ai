import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../api/client";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import type { ModelVersion, Setting } from "../api/types";
import { PageHead } from "../components/PageHead";
import { Empty, ErrorState, Loading } from "../components/States";
import { useToast } from "../components/toastContext";

function friendly(error: unknown) {
  return error instanceof ApiError ? error.friendly : "The request failed.";
}

function Operations() {
  const toast = useToast();
  const client = useQueryClient();
  const optimize = useMutation({
    mutationFn: api.runOptimization,
    onSuccess: ({ data }) => {
      toast.show(`Optimization done: ${fmt.int(data.high)} high risk, ${fmt.int(data.reorders)} reorders, ${fmt.int(data.transfers)} transfers.`);
      void client.invalidateQueries();
    },
    onError: (e) => toast.show(friendly(e), "error"),
  });
  const forecast = useMutation({
    mutationFn: api.requestForecast,
    onSuccess: ({ data }) => {
      toast.show(`Forecast run queued (${data.run_id.slice(0, 8)}). Watch it in the job list.`);
      void client.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => toast.show(friendly(e), "error"),
  });
  const evaluate = useMutation({
    mutationFn: api.runEvaluation,
    onSuccess: ({ data }) => {
      toast.show(`Evaluation done: ${data.caught} of ${data.evaluated} disruptions flagged at least 7 days ahead.`);
      void client.invalidateQueries({ queryKey: ["evaluation"] });
    },
    onError: (e) => toast.show(friendly(e), "error"),
  });
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Operations</h2>
      </div>
      <div className="grid two">
        {[
          { title: "Run optimization", text: "Reassess all products at all warehouses and replace waiting recommendations.", m: optimize },
          { title: "Request a forecast", text: "Queue a new 28-day forecast with the active model.", m: forecast },
          { title: "Check planted disruptions", text: "Replay the risk engine over each planted supply disruption. Takes about a minute.", m: evaluate },
        ].map((op) => (
          <div key={op.title} style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <h3>{op.title}</h3>
            <p className="muted">{op.text}</p>
            <div>
              <button type="button" className="btn primary" disabled={op.m.isPending} onClick={() => op.m.mutate()}>
                {op.m.isPending ? "Running…" : op.title}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingRow({ setting }: { setting: Setting }) {
  const toast = useToast();
  const client = useQueryClient();
  const [value, setValue] = useState(String(setting.value));
  const [error, setError] = useState<string | null>(null);
  const numeric = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(numeric) && numeric >= setting.minValue && numeric <= setting.maxValue;
  const dirty = valid && numeric !== setting.value;
  const save = useMutation({
    mutationFn: () => api.updateSetting(setting.key, numeric, setting.version),
    onSuccess: () => {
      setError(null);
      toast.show(`${setting.key} set to ${numeric}. Recorded in the audit log.`);
      void client.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => setError(friendly(e)),
  });
  return (
    <tr>
      <td>
        <div className="mono cell-title">{setting.key}</div>
        <div className="cell-sub">{setting.description}</div>
        {error && <div className="cell-sub" style={{ color: "var(--high)" }} role="alert">{error}</div>}
      </td>
      <td>
        <input
          id={`setting-${setting.key}`}
          className="input num"
          style={{ width: 120 }}
          type="number"
          step="any"
          aria-label={`${setting.key} value`}
          aria-invalid={!valid}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </td>
      <td className="num muted">
        {setting.minValue} – {setting.maxValue}
      </td>
      <td>
        <div>{setting.updatedBy}</div>
        <div className="cell-sub">v{setting.version} · {fmt.time(setting.updatedAt)}</div>
      </td>
      <td>
        <button type="button" className="btn small primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </td>
    </tr>
  );
}

function Settings() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: ({ signal }) => api.settings(signal) });
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Planning settings</h2>
        <span className="muted">Changes apply to the next optimization run</span>
      </div>
      {settings.isLoading && <Loading />}
      {settings.error && <ErrorState error={settings.error} retry={() => void settings.refetch()} />}
      {settings.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Setting</th>
                <th>Value</th>
                <th className="num">Allowed</th>
                <th>Last change</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.data.map((s) => (
                <SettingRow key={`${s.key}-${s.version}`} setting={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ModelRow({ model }: { model: ModelVersion }) {
  const toast = useToast();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const activate = useMutation({
    mutationFn: () => api.activateModel(model.model_version, reason.trim()),
    onSuccess: () => {
      toast.show(`${model.model_version} is now the active model.`);
      setAsking(false);
      setReason("");
      void client.invalidateQueries();
    },
    onError: (e) => toast.show(friendly(e), "error"),
  });
  const tone = model.status === "ACTIVE" ? "low" : model.status === "REJECTED" ? "high" : "neutral";
  return (
    <tr>
      <td>
        <div className="mono cell-title">{model.model_version}</div>
        <div className="cell-sub">{model.status_reason ?? model.algorithm}</div>
      </td>
      <td><span className={`chip ${tone}`}>{fmt.status(model.status)}</span></td>
      <td className="num">{fmt.pct(model.metrics.weekly.wape)} <span className="muted">vs {fmt.pct(model.metrics.weekly.baseline_wape)}</span></td>
      <td className="num">{fmt.pct(model.metrics.daily.wape)}</td>
      <td>{model.passed_gate ? <span className="chip low">Passed</span> : <span className="chip high">Failed</span>}</td>
      <td>
        {model.status === "ACTIVE" ? (
          <span className="muted">Live</span>
        ) : !model.passed_gate ? (
          <span className="muted">Cannot activate</span>
        ) : asking ? (
          <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
            <input
              id={`reason-${model.model_version}`}
              className="input"
              placeholder="Reason, e.g. roll back after bad week"
              aria-label="Reason for activation"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="btn-row">
              <button type="button" className="btn small primary" disabled={reason.trim().length < 3 || activate.isPending} onClick={() => activate.mutate()}>
                {activate.isPending ? "Activating…" : "Confirm"}
              </button>
              <button type="button" className="btn small" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn small" onClick={() => setAsking(true)}>
            {model.status === "RETIRED" ? "Roll back to this" : "Activate"}
          </button>
        )}
      </td>
    </tr>
  );
}

function Models() {
  const models = useQuery({ queryKey: ["models"], queryFn: ({ signal }) => api.models(signal) });
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Forecast models</h2>
        <span className="muted">Only models that pass the quality gate can go live</span>
      </div>
      {models.isLoading && <Loading />}
      {models.error && <ErrorState error={models.error} retry={() => void models.refetch()} />}
      {models.data && models.data.items.length === 0 && <Empty title="No models trained yet" />}
      {models.data && models.data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th className="num">Weekly WAPE</th>
                <th className="num">Daily WAPE</th>
                <th>Gate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {models.data.items.map((m) => (
                <ModelRow key={`${m.model_version}-${m.status}`} model={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EvaluationPanel() {
  const evaluation = useQuery({ queryKey: ["evaluation"], queryFn: ({ signal }) => api.evaluation(signal) });
  const e = evaluation.data;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Planted disruptions flagged in time</h2>
        {e && (
          <span className="chip accent">
            {e.caught} of {e.evaluated} caught · {fmt.pct(e.cellShare, 0)} of affected items flagged 7+ days ahead
          </span>
        )}
      </div>
      {evaluation.isLoading && <Loading />}
      {evaluation.error && <ErrorState error={evaluation.error} retry={() => void evaluation.refetch()} />}
      {e && e.disruptions.length === 0 && <Empty title="Not evaluated yet">Run the check above.</Empty>}
      {e && e.disruptions.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>Disruption</th>
                <th>Starts</th>
                <th className="num">Items hit</th>
                <th className="num">Flagged 7+ days ahead</th>
                <th className="num">Median warning</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {e.disruptions.map((d) => (
                <tr key={d.disruptionId}>
                  <td>
                    <div className="cell-title">
                      <span className="mono">{d.disruptionId}</span> · {fmt.status(d.kind)}
                    </div>
                    <div className="cell-sub">{d.description}</div>
                  </td>
                  <td>{fmt.date(d.startDate)}</td>
                  <td className="num">{fmt.int(d.impactedCells)}</td>
                  <td className="num">
                    {fmt.int(d.flaggedSevenDaysAhead)} ({fmt.pct(d.share, 0)})
                  </td>
                  <td className="num">{d.medianLeadDays == null ? "—" : `${d.medianLeadDays} d`}</td>
                  <td>{d.caught ? <span className="chip low">Caught</span> : <span className="chip high">Missed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Jobs() {
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: ({ signal }) => api.jobs(signal), refetchInterval: 5000 });
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Recent jobs</h2>
        <span className="muted">Refreshes every 5 seconds</span>
      </div>
      {jobs.isLoading && <Loading />}
      {jobs.error && <ErrorState error={jobs.error} retry={() => void jobs.refetch()} />}
      {jobs.data && jobs.data.length === 0 && <Empty title="No jobs yet" />}
      {jobs.data && jobs.data.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Detail</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.map((j) => {
                const tone = ["SUCCEEDED", "ACTIVE"].includes(j.status) ? "low" : ["FAILED", "REJECTED"].includes(j.status) ? "high" : "medium";
                return (
                  <tr key={`${j.kind}-${j.id}`}>
                    <td>
                      <div className="cell-title">{fmt.status(j.kind)}</div>
                      <div className="cell-sub mono">{j.id.length > 24 ? `${j.id.slice(0, 8)}…` : j.id}</div>
                    </td>
                    <td><span className={`chip ${tone}`}>{fmt.status(j.status)}</span></td>
                    <td>{j.detail}</td>
                    <td className="mono">{fmt.time(j.startedAt)}</td>
                    <td className="mono">{j.finishedAt ? fmt.time(j.finishedAt) : "running"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Admin() {
  return (
    <>
      <PageHead eyebrow="Admin only" title="Admin">
        Planning settings, forecast models, job runs and the planted-disruption check. Admins manage the platform but never approve orders.
      </PageHead>
      <Operations />
      <Settings />
      <Models />
      <EvaluationPanel />
      <Jobs />
    </>
  );
}
