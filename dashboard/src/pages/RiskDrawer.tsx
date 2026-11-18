import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import { RiskChip } from "../components/RiskChip";
import { ErrorState, Loading } from "../components/States";

export function RiskDrawer({ sku, warehouseId, onClose }: { sku: string; warehouseId: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const detail = useQuery({
    queryKey: ["risk", sku, warehouseId],
    queryFn: ({ signal }) => api.risk(sku, warehouseId, signal),
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="risk-drawer-title">
        <div className="drawer-head">
          <div>
            <div className="eyebrow mono">
              {sku} · {warehouseId}
            </div>
            <h2 id="risk-drawer-title">{detail.data?.product.name ?? sku}</h2>
          </div>
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {detail.isLoading && <Loading />}
        {detail.error && <ErrorState error={detail.error} retry={() => void detail.refetch()} />}
        {detail.data && (
          <div className="panel">
            <dl className="dl">
              <div>
                <dt>Risk</dt>
                <dd><RiskChip level={detail.data.risk.riskLevel} /></dd>
              </div>
              <div>
                <dt>On hand</dt>
                <dd>{fmt.int(detail.data.risk.onHand)}</dd>
              </div>
              <div>
                <dt>Stockout</dt>
                <dd>{fmt.date(detail.data.risk.projectedStockoutDate)}</dd>
              </div>
            </dl>
          </div>
        )}
      </aside>
    </>
  );
}
