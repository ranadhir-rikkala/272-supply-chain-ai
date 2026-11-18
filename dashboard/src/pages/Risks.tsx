import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CATEGORIES, WAREHOUSE_IDS, categoryName } from "../api/catalog";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import type { RiskLevel } from "../api/types";
import { PageHead } from "../components/PageHead";
import { Pager } from "../components/Pager";
import { RiskChip } from "../components/RiskChip";
import { Empty, ErrorState, Loading } from "../components/States";
import { useDebounced } from "../hooks";
import { RiskDrawer } from "./RiskDrawer";

const SIZE = 25;

export function Risks() {
  const [params, setParams] = useSearchParams();
  const level = (params.get("level") ?? "") as RiskLevel | "";
  const warehouseId = params.get("warehouseId") ?? "";
  const category = params.get("category") ?? "";
  const page = Number(params.get("page") ?? 0);
  const selectedSku = params.get("sku");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const debounced = useDebounced(search);

  function update(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true });
  }

  useEffect(() => {
    if ((params.get("search") ?? "") === debounced) return;
    const merged = new URLSearchParams(params);
    if (debounced) merged.set("search", debounced);
    else merged.delete("search");
    merged.delete("page");
    setParams(merged, { replace: true });
  }, [debounced, params, setParams]);

  const risks = useQuery({
    queryKey: ["risks", level, warehouseId, category, debounced, page],
    queryFn: ({ signal }) => api.risks({ level, warehouseId, category, search: debounced, page, size: SIZE }, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHead eyebrow="Stockout and overstock risk" title="Risks">
        Every product at every warehouse, ranked by how soon it runs out compared with the supplier lead time.
      </PageHead>
      <div className="panel filters" role="search">
        <label className="field">
          <span>Risk</span>
          <select id="filter-level" className="input" value={level} onChange={(e) => update({ level: e.target.value, page: null })}>
            <option value="">All levels</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        <label className="field">
          <span>Warehouse</span>
          <select id="filter-warehouse" className="input" value={warehouseId} onChange={(e) => update({ warehouseId: e.target.value, page: null })}>
            <option value="">All warehouses</option>
            {WAREHOUSE_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Category</span>
          <select id="filter-category" className="input" value={category} onChange={(e) => update({ category: e.target.value, page: null })}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 220px" }}>
          <span>Search</span>
          <input id="filter-search" className="input" type="search" placeholder="Product name or SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {risks.isLoading && <Loading />}
      {risks.error && <ErrorState error={risks.error} retry={() => void risks.refetch()} />}
      {risks.data && risks.data.items.length === 0 && <Empty title="No products match these filters">Clear a filter to see more.</Empty>}
      {risks.data && risks.data.items.length > 0 && (
        <>
          <div className="table-wrap" style={{ opacity: risks.isPlaceholderData ? 0.6 : 1 }}>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Risk</th>
                  <th className="num">On hand</th>
                  <th className="num">On order</th>
                  <th className="num">Daily demand</th>
                  <th className="num">Cover</th>
                  <th>Stockout</th>
                  <th className="num">Lead time</th>
                </tr>
              </thead>
              <tbody>
                {risks.data.items.map((r) => (
                  <tr
                    key={`${r.sku}-${r.warehouseId}`}
                    className="clickable"
                    tabIndex={0}
                    aria-label={`Open ${r.productName} at ${r.warehouseId}`}
                    onClick={() => update({ sku: r.sku, warehouseId: r.warehouseId })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") update({ sku: r.sku, warehouseId: r.warehouseId });
                    }}
                  >
                    <td>
                      <div className="cell-title">{r.productName}</div>
                      <div className="cell-sub">
                        <span className="mono">{r.sku}</span> · {categoryName(r.categoryCode)}
                      </div>
                    </td>
                    <td className="mono">{r.warehouseId}</td>
                    <td>
                      <span className="btn-row" style={{ gap: 4 }}>
                        <RiskChip level={r.riskLevel} />
                        {r.overstocked && <span className="chip over">Overstock</span>}
                      </span>
                    </td>
                    <td className="num">{fmt.int(r.onHand)}</td>
                    <td className="num">{fmt.int(r.onOrder)}</td>
                    <td className="num">{r.meanDailyDemand.toFixed(1)}</td>
                    <td className="num">{r.daysOfCover == null ? "—" : `${r.daysOfCover} d`}</td>
                    <td>{fmt.date(r.projectedStockoutDate)}</td>
                    <td className="num">{Math.ceil(r.leadTimeDays)} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={SIZE} total={risks.data.total} onPage={(next) => update({ page: String(next) })} />
        </>
      )}
      {selectedSku && warehouseId && (
        <RiskDrawer sku={selectedSku} warehouseId={warehouseId} onClose={() => update({ sku: null })} />
      )}
    </>
  );
}
