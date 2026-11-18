import type { Flow } from "./flows";
import { project } from "./geo";

function curve(from: [number, number], to: [number, number], trim: number) {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.min(80, length * 0.25);
  const cx = (x0 + x1) / 2 - (dy / length) * bend;
  const cy = (y0 + y1) / 2 + (dx / length) * bend;
  const start = trimToward(x0, y0, cx, cy, trim);
  const end = trimToward(x1, y1, cx, cy, trim + 4);
  return `M ${start[0]} ${start[1]} Q ${cx} ${cy} ${end[0]} ${end[1]}`;
}

function trimToward(x: number, y: number, tx: number, ty: number, distance: number): [number, number] {
  const length = Math.hypot(tx - x, ty - y) || 1;
  return [x + ((tx - x) / length) * distance, y + ((ty - y) / length) * distance];
}

export function TransferFlows({ flows, active, onHover }: { flows: Flow[]; active: string | null; onHover: (key: string | null) => void }) {
  const max = Math.max(1, ...flows.map((f) => f.quantity));
  return (
    <g aria-label="Pending transfers">
      <defs>
        <marker id="flow-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="map-flow-head" />
        </marker>
      </defs>
      {flows.map((flow) => {
        const from = project(flow.source.longitude, flow.source.latitude);
        const to = project(flow.destination.longitude, flow.destination.latitude);
        if (!from || !to) return null;
        const width = 2 + (flow.quantity / max) * 7;
        const dimmed = active != null && active !== flow.key;
        return (
          <path
            key={flow.key}
            d={curve(from, to, 26)}
            className="map-flow"
            strokeWidth={width}
            markerEnd="url(#flow-arrow)"
            style={{ opacity: dimmed ? 0.2 : 1 }}
            onMouseEnter={() => onHover(flow.key)}
            onMouseLeave={() => onHover(null)}
          >
            <title>{`${flow.source.warehouseId} → ${flow.destination.warehouseId}: ${flow.quantity} units in ${flow.orders} transfer${flow.orders === 1 ? "" : "s"}`}</title>
          </path>
        );
      })}
    </g>
  );
}
