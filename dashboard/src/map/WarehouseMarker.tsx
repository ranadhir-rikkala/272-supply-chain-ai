import type { Warehouse } from "../api/types";
import { arcPath } from "./geo";

const SEGMENTS: { key: "high" | "medium" | "low"; color: string }[] = [
  { key: "high", color: "var(--high)" },
  { key: "medium", color: "var(--medium)" },
  { key: "low", color: "var(--low)" },
];

export function WarehouseMarker({
  warehouse,
  x,
  y,
  selected,
  onSelect,
}: {
  warehouse: Warehouse;
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const total = warehouse.high + warehouse.medium + warehouse.low || 1;
  const radius = selected ? 26 : 22;
  const inner = radius - 8;
  let angle = 0;
  const label = `${warehouse.name}: ${warehouse.high} high, ${warehouse.medium} medium, ${warehouse.low} low risk`;
  return (
    <g
      className="map-wh"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <title>{label}</title>
      <circle className="ring" cx={x} cy={y} r={radius + 2} fill="var(--surface)" stroke={selected ? "var(--ink)" : "var(--line)"} strokeWidth={selected ? 2 : 1} />
      {SEGMENTS.map((segment) => {
        const sweep = (warehouse[segment.key] / total) * Math.PI * 2;
        const d = arcPath(x, y, radius, inner, angle, angle + sweep);
        angle += sweep;
        return d ? <path key={segment.key} d={d} fill={segment.color} /> : null;
      })}
      <text x={x} y={y + 4} textAnchor="middle" className="mono" fontSize="13" fontWeight="600" fill="var(--ink)">
        {warehouse.high}
      </text>
      <text x={x} y={y + radius + 18} textAnchor="middle" className="map-label">
        {warehouse.warehouseId.replace("WH-", "")}
      </text>
    </g>
  );
}
