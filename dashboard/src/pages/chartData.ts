import type { Series } from "../api/types";

export interface Point {
  date: string;
  sold?: number | null;
  stockout?: number | null;
  backtest?: number | null;
  baseline?: number | null;
  forecast?: number | null;
}

export function buildPoints(series: Series["data"]): Point[] {
  const byDate = new Map<string, Point>();
  const at = (date: string) => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const point: Point = { date };
    byDate.set(date, point);
    return point;
  };
  for (const h of series.history) {
    const point = at(h.date);
    point.sold = h.units_sold;
    point.stockout = h.stockout_flag ? 0 : null;
  }
  for (const b of series.backtest) {
    const point = at(b.date);
    point.backtest = b.yhat;
    point.baseline = b.baseline;
  }
  const lastHistory = series.history.at(-1);
  if (lastHistory && series.forecast.length) at(lastHistory.date).forecast = lastHistory.units_sold;
  for (const f of series.forecast) at(f.date).forecast = f.yhat;
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
