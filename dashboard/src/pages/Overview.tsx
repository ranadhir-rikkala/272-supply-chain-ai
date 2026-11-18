import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import { useSession } from "../auth/session";
import { PageHead } from "../components/PageHead";
import { RiskChip } from "../components/RiskChip";
import { ErrorState, Loading } from "../components/States";
import { useToast } from "../components/toastContext";

function Compare({ label, model, baseline }: { label: string; model: number; baseline: number }) {
  const max = Math.max(model, baseline, 0.0001);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="kpi-label">{label}</div>
      {[
        ["XGBoost", model, "var(--accent)"],
        ["Seasonal naive", baseline, "var(--muted)"],
      ].map(([name, value, color]) => (
        <div key={name as string} style={{ display: "grid", gridTemplateColumns: "110px 1fr 56px", gap: 8, alignItems: "center" }}>
          <span className="muted">{name}</span>
          <span style={{ height: 8, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${((value as number) / max) * 100}%`, background: color as string }} />
          </span>
          <span className="num" style={{ textAlign: "right" }}>{fmt.pct(value as number)}</span>
        </div>
      ))}
    </div>
  );
}

export function Overview() {
  const session = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const summary = useQuery({ queryKey: ["summary"], queryFn: ({ signal }) => api.summary(signal) });
  const urgent = useQuery({
    queryKey: ["risks", "urgent"],
    queryFn: ({ signal }) => api.risks({ level: "HIGH", page: 0, size: 6 }, signal),
  });
  const optimize = useMutation({
    mutationFn: api.runOptimization,
    onSuccess: ({ data }) => {
      toast.show(`Optimization finished: ${fmt.int(data.high)} high-risk cells, ${fmt.int(data.reorders)} reorders, ${fmt.int(data.transfers)} transfers.`);
      void client.invalidateQueries();
    },
    onError: (error) => toast.show(error instanceof ApiError ? error.friendly : "Optimization failed.", "error"),
  });

  if (summary.isLoading) return <Loading />;
  if (summary.error || !summary.data) return <ErrorState error={summary.error} retry={() => void summary.refetch()} />;
  const s = summary.data;
  const pending = s.approvals.pendingReview + s.approvals.pendingManager;
  const quarantineShare = s.data.rowsLoaded + s.data.rowsQuarantined > 0 ? s.data.rowsQuarantined / (s.data.rowsLoaded + s.data.rowsQuarantined) : 0;

  return (
    <>
      <PageHead
        eyebrow={s.optimization ? `Position as of ${fmt.date(s.optimization.asOfDate)}` : "No optimization run yet"}
        title="Overview"
        actions={
          session.has("PLANNER", "ADMIN") && (
            <button type="button" className="btn primary" disabled={optimize.isPending} onClick={() => optimize.mutate()}>
              {optimize.isPending ? "Running…" : "Run optimization"}
            </button>
          )
        }
      >
        Where stock will run out, what to reorder or move, and what is waiting for a decision.
      </PageHead>

      <section className="grid kpis" aria-label="Headline numbers">
        <Link to="/risks?level=HIGH" className="panel kpi high" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="kpi-label">High risk</span>
          <span className="kpi-value">{fmt.int(s.optimization?.high)}</span>
          <span className="kpi-note">stock runs out before the supplier can deliver</span>
        </Link>
        <Link to="/risks?level=MEDIUM" className="panel kpi medium" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="kpi-label">Medium risk</span>
          <span className="kpi-value">{fmt.int(s.optimization?.medium)}</span>
          <span className="kpi-note">within the safety buffer</span>
        </Link>
        <Link to="/approvals" className="panel kpi accent" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="kpi-label">Waiting for approval</span>
          <span className="kpi-value">{fmt.int(pending)}</span>
          <span className="kpi-note">
            {fmt.money(s.approvals.pendingValue)} · {fmt.int(s.approvals.pendingManager)} need a manager
          </span>
        </Link>
        <Link to="/orders" className="panel kpi" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="kpi-label">Draft orders</span>
          <span className="kpi-value">{fmt.int(s.orders.purchaseOrders + s.orders.transferOrders)}</span>
          <span className="kpi-note">
            {fmt.int(s.orders.purchaseOrders)} purchase · {fmt.int(s.orders.transferOrders)} transfer · {fmt.money(s.orders.value)}
          </span>
        </Link>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-head">
            <h2>Demand forecast</h2>
            <span className="chip accent mono">{s.model?.modelVersion ?? "no active model"}</span>
          </div>
          {s.model ? (
            <div style={{ display: "grid", gap: 12 }}>
              <Compare label="Weekly error (WAPE), last 6 months" model={s.model.weeklyWape} baseline={s.model.baselineWeeklyWape} />
              <p className="muted">
                Lower is better. The quality gate needs weekly WAPE under 25% and below the baseline before a model can go live.
              </p>
            </div>
          ) : (
            <p className="muted">No model has passed the quality gate yet.</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Data quality</h2>
            <span className="chip neutral">latest feed {fmt.date(s.data.latestFeed)}</span>
          </div>
          <div className="dl">
            <div>
              <dt>Rows loaded</dt>
              <dd className="num">{fmt.int(s.data.rowsLoaded)}</dd>
            </div>
            <div>
              <dt>Rows quarantined</dt>
              <dd className="num">{fmt.int(s.data.rowsQuarantined)}</dd>
            </div>
            <div>
              <dt>Quarantine share</dt>
              <dd className="num">{fmt.pct(quarantineShare, 2)}</dd>
            </div>
            <div>
              <dt>Forecast service</dt>
              <dd>
                <span className={`chip ${s.forecastServiceCircuit === "CLOSED" ? "low" : "high"}`}>
                  {s.forecastServiceCircuit === "CLOSED" ? "Healthy" : `Circuit ${s.forecastServiceCircuit.toLowerCase()}`}
                </span>
              </dd>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Running out first</h2>
          <Link to="/risks?level=HIGH">All high-risk items</Link>
        </div>
        {urgent.isLoading && <Loading />}
        {urgent.error && <ErrorState error={urgent.error} retry={() => void urgent.refetch()} />}
        {urgent.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Risk</th>
                  <th className="num">On hand</th>
                  <th>Stockout</th>
                  <th className="num">Lead time</th>
                </tr>
              </thead>
              <tbody>
                {urgent.data.items.map((r) => (
                  <tr key={`${r.sku}-${r.warehouseId}`}>
                    <td>
                      <Link to={`/risks?sku=${r.sku}&warehouseId=${r.warehouseId}`} className="cell-title">{r.productName}</Link>
                      <div className="cell-sub mono">{r.sku}</div>
                    </td>
                    <td className="mono">{r.warehouseId}</td>
                    <td><RiskChip level={r.riskLevel} /></td>
                    <td className="num">{fmt.int(r.onHand)}</td>
                    <td>{fmt.date(r.projectedStockoutDate)}</td>
                    <td className="num">{r.leadTimeDays.toFixed(0)} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
