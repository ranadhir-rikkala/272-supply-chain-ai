import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import { PageHead } from "../components/PageHead";
import { Pager } from "../components/Pager";
import { Empty, ErrorState, Loading } from "../components/States";

const SIZE = 25;
const KINDS = [
  { id: "", label: "All orders" },
  { id: "PURCHASE", label: "Purchase orders" },
  { id: "TRANSFER", label: "Transfer orders" },
];

export function Orders() {
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const page = Number(params.get("page") ?? 0);
  const orders = useQuery({
    queryKey: ["orders", kind, page],
    queryFn: ({ signal }) => api.orders({ kind, page, size: SIZE }, signal),
    placeholderData: keepPreviousData,
  });
  const go = (next: Record<string, string>) => setParams(new URLSearchParams({ ...(kind ? { kind } : {}), ...next }), { replace: true });

  return (
    <>
      <PageHead eyebrow="Created by approvals" title="Orders">
        Approved recommendations become draft purchase and transfer orders, ready to send to suppliers and warehouses.
      </PageHead>
      <div className="btn-row" role="tablist" aria-label="Order type">
        {KINDS.map((k) => (
          <button
            key={k.id || "all"}
            type="button"
            role="tab"
            aria-selected={kind === k.id}
            className={`btn${kind === k.id ? " primary" : ""}`}
            onClick={() => setParams(k.id ? { kind: k.id } : {}, { replace: true })}
          >
            {k.label}
          </button>
        ))}
      </div>
      {orders.isLoading && <Loading />}
      {orders.error && <ErrorState error={orders.error} retry={() => void orders.refetch()} />}
      {orders.data && orders.data.items.length === 0 && (
        <Empty title="No draft orders yet">Approve a recommendation and its draft order appears here.</Empty>
      )}
      {orders.data && orders.data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Product</th>
                  <th>Route</th>
                  <th className="num">Units</th>
                  <th className="num">Value</th>
                  <th className="num">Freight</th>
                  <th>Arrives</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.orderId}>
                    <td>
                      <div className="mono cell-title">{o.orderId}</div>
                      <span className={`chip ${o.kind === "TRANSFER" ? "accent" : "neutral"}`}>{o.kind === "TRANSFER" ? "Transfer" : "Purchase"}</span>
                    </td>
                    <td>
                      <div className="cell-title">{o.productName}</div>
                      <div className="cell-sub mono">{o.sku}</div>
                    </td>
                    <td className="mono">
                      {o.kind === "TRANSFER" ? `${o.sourceWarehouseId} → ${o.warehouseId}` : `${o.supplierId} → ${o.warehouseId}`}
                    </td>
                    <td className="num">{fmt.int(o.quantity)}</td>
                    <td className="num">{fmt.money(o.totalValue)}</td>
                    <td className="num">{fmt.money(o.freightCost)}</td>
                    <td>{fmt.date(o.expectedArrival)}</td>
                    <td>
                      <div>{o.createdBy}</div>
                      <div className="cell-sub">{fmt.time(o.createdAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={SIZE} total={orders.data.total} onPage={(next) => go({ page: String(next) })} />
        </>
      )}
    </>
  );
}
