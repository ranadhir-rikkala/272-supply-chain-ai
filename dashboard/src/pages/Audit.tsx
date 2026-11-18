import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import { PageHead } from "../components/PageHead";
import { Pager } from "../components/Pager";
import { Empty, ErrorState, Loading } from "../components/States";
import { useDebounced } from "../hooks";

const SIZE = 25;
const ENTITY_TYPES = [
  { id: "recommendation", label: "Recommendations" },
  { id: "setting", label: "Settings" },
  { id: "model_version", label: "Model versions" },
  { id: "optimization_run", label: "Optimization runs" },
  { id: "forecast_run", label: "Forecast runs" },
  { id: "training_job", label: "Training jobs" },
  { id: "evaluation", label: "Evaluations" },
];

function pretty(value: string | null): string {
  if (!value) return "—";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function tone(action: string): string {
  if (action.includes("REJECT")) return "high";
  if (action.includes("OVERRIDE") || action.includes("SETTING") || action.includes("ACTIVATED")) return "medium";
  if (action.includes("APPROV")) return "low";
  return "neutral";
}

export function Audit() {
  const [params, setParams] = useSearchParams();
  const entityType = params.get("entityType") ?? "";
  const page = Number(params.get("page") ?? 0);
  const [actor, setActor] = useState(params.get("actor") ?? "");
  const debouncedActor = useDebounced(actor.trim());
  const [expanded, setExpanded] = useState<number | null>(null);
  const audit = useQuery({
    queryKey: ["audit", entityType, debouncedActor, page],
    queryFn: ({ signal }) => api.audit({ entityType, actor: debouncedActor, page, size: SIZE }, signal),
    placeholderData: keepPreviousData,
  });

  function update(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  }

  return (
    <>
      <PageHead eyebrow="Append-only" title="Audit trail">
        Every approval, override, setting change, model activation and job run, with who did it and what changed. Entries cannot be edited
        or deleted.
      </PageHead>
      <div className="panel filters">
        <label className="field">
          <span>What changed</span>
          <select id="audit-entity" className="input" value={entityType} onChange={(e) => update({ entityType: e.target.value, page: null })}>
            <option value="">Everything</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Who</span>
          <input
            id="audit-actor"
            className="input"
            type="search"
            placeholder="Username, e.g. max.manager"
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              update({ page: null });
            }}
          />
        </label>
      </div>
      {audit.isLoading && <Loading />}
      {audit.error && <ErrorState error={audit.error} retry={() => void audit.refetch()} />}
      {audit.data && audit.data.items.length === 0 && <Empty title="No audit entries match" />}
      {audit.data && audit.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Item</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((entry) => (
                  <Fragment key={entry.auditId}>
                    <tr>
                      <td className="mono">{fmt.time(entry.occurredAt)}</td>
                      <td>
                        <div className="cell-title">{entry.actor}</div>
                        <div className="cell-sub">{entry.actorRoles.map(fmt.status).join(", ")}</div>
                      </td>
                      <td>
                        <span className={`chip ${tone(entry.action)}`}>{fmt.status(entry.action)}</span>
                      </td>
                      <td>
                        <div>{fmt.status(entry.entityType)}</div>
                        <div className="cell-sub mono">{entry.entityId.length > 24 ? `${entry.entityId.slice(0, 8)}…` : entry.entityId}</div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn small"
                          aria-expanded={expanded === entry.auditId}
                          onClick={() => setExpanded(expanded === entry.auditId ? null : entry.auditId)}
                        >
                          {expanded === entry.auditId ? "Hide" : "Before / after"}
                        </button>
                      </td>
                    </tr>
                    {expanded === entry.auditId && (
                      <tr>
                        <td colSpan={5}>
                          <div className="diff">
                            <div>
                              <div className="eyebrow">Before</div>
                              <pre>{pretty(entry.before)}</pre>
                            </div>
                            <div>
                              <div className="eyebrow">After</div>
                              <pre>{pretty(entry.after)}</pre>
                            </div>
                          </div>
                          {entry.requestId && <p className="muted mono" style={{ marginTop: 6 }}>request {entry.requestId}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={SIZE} total={audit.data.total} onPage={(next) => update({ page: String(next) })} />
        </>
      )}
    </>
  );
}
