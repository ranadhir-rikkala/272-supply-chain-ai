import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/endpoints";
import { fmt } from "../api/format";
import type { Warehouse } from "../api/types";
import { PageHead } from "../components/PageHead";
import { RiskChip } from "../components/RiskChip";
import { Empty, ErrorState, Loading } from "../components/States";
import { BORDER_PATH, MAP_HEIGHT, MAP_WIDTH, NATION_PATH, STATE_PATHS, project } from "../map/geo";
import { WarehouseMarker } from "../map/WarehouseMarker";

function WarehousePanel({ warehouse }: { warehouse: Warehouse }) {
  const total = warehouse.high + warehouse.medium + warehouse.low || 1;
  const risks = useQuery({
    queryKey: ["risks", "warehouse", warehouse.warehouseId],
    queryFn: ({ signal }) => api.risks({ warehouseId: warehouse.warehouseId, page: 0, size: 8 }, signal),
  });
  return (
    <div className="panel" style={{ display: "grid", gap: 12 }}>
      <div>
        <div className="eyebrow">{warehouse.warehouseId}</div>
        <h2>{warehouse.name}</h2>
        <p className="muted">
          {warehouse.city}, {warehouse.state}
        </p>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <div className="bar-mix" aria-hidden="true">
          <span className="h" style={{ width: `${(warehouse.high / total) * 100}%` }} />
          <span className="m" style={{ width: `${(warehouse.medium / total) * 100}%` }} />
          <span className="l" style={{ width: `${(warehouse.low / total) * 100}%` }} />
        </div>
        <div className="legend">
          <span><i style={{ background: "var(--high)" }} />{warehouse.high} high</span>
          <span><i style={{ background: "var(--medium)" }} />{warehouse.medium} medium</span>
          <span><i style={{ background: "var(--low)" }} />{warehouse.low} low</span>
          <span><i style={{ background: "var(--over)" }} />{warehouse.overstocked} overstocked</span>
        </div>
      </div>
      <div className="dl">
        <div>
          <dt>Transfers in</dt>
          <dd className="num">{warehouse.pendingInbound}</dd>
        </div>
        <div>
          <dt>Transfers out</dt>
          <dd className="num">{warehouse.pendingOutbound}</dd>
        </div>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <h3>Top risks</h3>
        {risks.isLoading && <Loading />}
        {risks.error && <ErrorState error={risks.error} retry={() => void risks.refetch()} />}
        {risks.data && risks.data.items.length === 0 && <Empty title="No assessments for this warehouse" />}
        {risks.data?.items.map((r) => (
          <Link
            key={r.sku}
            to={`/risks?sku=${r.sku}&warehouseId=${r.warehouseId}`}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8, color: "inherit", textDecoration: "none" }}
          >
            <span style={{ minWidth: 0 }}>
              <span className="cell-title">{r.productName}</span>
              <span className="cell-sub"> · stockout {fmt.date(r.projectedStockoutDate)}</span>
            </span>
            <RiskChip level={r.riskLevel} />
          </Link>
        ))}
        <Link to={`/risks?warehouseId=${warehouse.warehouseId}`}>All risks at {warehouse.warehouseId}</Link>
      </div>
    </div>
  );
}

export function SupplyMap() {
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: ({ signal }) => api.warehouses(signal) });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (warehouses.isLoading) return <Loading />;
  if (warehouses.error || !warehouses.data) return <ErrorState error={warehouses.error} retry={() => void warehouses.refetch()} />;
  const selected = warehouses.data.find((w) => w.warehouseId === selectedId) ?? [...warehouses.data].sort((a, b) => b.high - a.high)[0];

  return (
    <>
      <PageHead eyebrow="8 distribution centers" title="Supply map">
        Each ring shows the risk mix at a warehouse; the number in the middle is how many products are high risk.
      </PageHead>
      <div className="map-layout">
        <div className="panel">
          <svg className="map-svg" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="group" aria-label="Map of US warehouses">
            <g>
              {STATE_PATHS.map((state) => (
                <path key={state.id} d={state.d} className="map-land" />
              ))}
              <path d={BORDER_PATH} className="map-land" fill="none" />
              <path d={NATION_PATH} className="map-nation" />
            </g>
            {warehouses.data.map((w) => {
              const point = project(w.longitude, w.latitude);
              if (!point) return null;
              return (
                <WarehouseMarker
                  key={w.warehouseId}
                  warehouse={w}
                  x={point[0]}
                  y={point[1]}
                  selected={selected?.warehouseId === w.warehouseId}
                  onSelect={() => setSelectedId(w.warehouseId)}
                />
              );
            })}
          </svg>
          <div className="legend">
            <span><i style={{ background: "var(--high)" }} />High risk</span>
            <span><i style={{ background: "var(--medium)" }} />Medium</span>
            <span><i style={{ background: "var(--low)" }} />Low</span>
          </div>
        </div>
        {selected && <WarehousePanel warehouse={selected} />}
      </div>
    </>
  );
}
