import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import { RiskChip } from "../components/RiskChip";
import { Empty, ErrorState, Loading } from "../components/States";
import { ForecastChart } from "./ForecastChart";

export function RiskDrawer({ sku, warehouseId, onClose }: { sku: string; warehouseId: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const detail = useQuery({
    queryKey: ["risk", sku, warehouseId],
    queryFn: ({ signal }) => api.risk(sku, warehouseId, signal),
  });
  const series = useQuery({
    queryKey: ["series", sku, warehouseId],
    queryFn: ({ signal }) => api.series(sku, warehouseId, 120, signal),
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = detail.data;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="risk-drawer-title">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow mono">
              {sku} · {warehouseId}
            </div>
            <h2 id="risk-drawer-title">{d?.product.name ?? sku}</h2>
            {d && (
              <div className="btn-row" style={{ marginTop: 6 }}>
                <RiskChip level={d.risk.riskLevel} />
                {d.risk.overstocked && <span className="chip over">Overstock</span>}
                <span className="chip neutral">{d.product.categoryName}</span>
              </div>
            )}
          </div>
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h3>Demand: history, backtest and forecast</h3>
            {series.data?.forecastAvailable && series.data.data.forecast[0] && (
              <span className="chip accent mono">{series.data.data.forecast[0].model_version}</span>
            )}
          </div>
          {series.isLoading && <Loading label="Loading demand" />}
          {series.error && <ErrorState error={series.error} retry={() => void series.refetch()} />}
          {series.data && !series.data.forecastAvailable && (
            <div className="notice" role="status" style={{ marginBottom: 10 }}>
              The forecast service is unavailable right now, so only sales history is shown. {series.data.reason}
            </div>
          )}
          {series.data && <ForecastChart series={series.data.data} />}
        </section>

        {detail.isLoading && <Loading />}
        {detail.error && <ErrorState error={detail.error} retry={() => void detail.refetch()} />}
        {d && (
          <>
            <section className="panel">
              <h3 style={{ marginBottom: 10 }}>Position</h3>
              <dl className="dl">
                <div><dt>On hand</dt><dd className="num">{fmt.int(d.risk.onHand)}</dd></div>
                <div><dt>On order</dt><dd className="num">{fmt.int(d.risk.onOrder)}</dd></div>
                <div><dt>Daily demand</dt><dd className="num">{d.risk.meanDailyDemand.toFixed(1)} ± {d.risk.sdDailyDemand.toFixed(1)}</dd></div>
                <div><dt>Days of cover</dt><dd className="num">{d.risk.daysOfCover ?? "beyond horizon"}</dd></div>
                <div><dt>Projected stockout</dt><dd>{fmt.date(d.risk.projectedStockoutDate)}</dd></div>
                <div><dt>Supplier lead time</dt><dd className="num">{d.risk.leadTimeDays.toFixed(1)} days</dd></div>
                <div><dt>Safety stock</dt><dd className="num">{fmt.int(d.risk.safetyStock)}</dd></div>
                <div><dt>Reorder point</dt><dd className="num">{fmt.int(d.risk.reorderPoint)}</dd></div>
              </dl>
            </section>

            <section className="panel">
              <h3 style={{ marginBottom: 10 }}>Supplier and product</h3>
              <dl className="dl">
                <div><dt>Supplier</dt><dd>{d.product.supplierName} <span className="muted mono">{d.product.supplierId}</span></dd></div>
                <div><dt>Region</dt><dd>{d.product.region}</dd></div>
                <div><dt>On-time rate</dt><dd className="num">{fmt.pct(d.product.onTimeRate, 0)}</dd></div>
                <div><dt>Unit cost</dt><dd className="num">{fmt.cents(d.product.unitCost)}</dd></div>
                <div><dt>Case pack</dt><dd className="num">{d.product.casePack}</dd></div>
                <div><dt>Shelf life</dt><dd>{d.product.shelfLifeDays ? `${d.product.shelfLifeDays} days` : "none"}</dd></div>
              </dl>
            </section>

            <section className="panel">
              <h3 style={{ marginBottom: 10 }}>Open purchase orders</h3>
              {d.openOrders.length === 0 ? (
                <Empty title="No open purchase orders" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>PO</th><th className="num">Units</th><th>Ordered</th><th>Promised</th><th>Expected</th><th /></tr>
                    </thead>
                    <tbody>
                      {d.openOrders.map((po) => (
                        <tr key={po.poId}>
                          <td className="mono">{po.poId}</td>
                          <td className="num">{fmt.int(po.orderQty)}</td>
                          <td>{fmt.date(po.orderDate)}</td>
                          <td>{fmt.date(po.promisedDate)}</td>
                          <td>{fmt.date(po.expectedDate)}</td>
                          <td>{po.delayed && <span className="chip high">Delayed</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel">
              <h3 style={{ marginBottom: 10 }}>Same product at other warehouses</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Warehouse</th><th>Risk</th><th className="num">On hand</th><th className="num">Cover</th></tr>
                  </thead>
                  <tbody>
                    {d.otherWarehouses.map((w) => (
                      <tr key={w.warehouseId}>
                        <td className="mono">{w.warehouseId}</td>
                        <td>
                          <span className="btn-row" style={{ gap: 4 }}>
                            <RiskChip level={w.riskLevel} />
                            {w.overstocked && <span className="chip over">Overstock</span>}
                          </span>
                        </td>
                        <td className="num">{fmt.int(w.onHand)}</td>
                        <td className="num">{w.daysOfCover == null ? "—" : `${w.daysOfCover} d`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </aside>
    </>
  );
}
