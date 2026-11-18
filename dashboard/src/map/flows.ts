import type { Recommendation, Warehouse } from "../api/types";

export interface Flow {
  key: string;
  source: Warehouse;
  destination: Warehouse;
  quantity: number;
  orders: number;
  value: number;
}

export function aggregateFlows(transfers: Recommendation[], warehouses: Warehouse[]): Flow[] {
  const byId = new Map(warehouses.map((w) => [w.warehouseId, w]));
  const flows = new Map<string, Flow>();
  for (const t of transfers) {
    if (!t.sourceWarehouseId) continue;
    const source = byId.get(t.sourceWarehouseId);
    const destination = byId.get(t.warehouseId);
    if (!source || !destination) continue;
    const key = `${source.warehouseId}>${destination.warehouseId}`;
    const flow = flows.get(key) ?? { key, source, destination, quantity: 0, orders: 0, value: 0 };
    flow.quantity += t.quantity;
    flow.orders += 1;
    flow.value += t.totalValue;
    flows.set(key, flow);
  }
  return [...flows.values()].sort((a, b) => b.quantity - a.quantity);
}
