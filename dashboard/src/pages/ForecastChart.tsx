import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, Area } from "recharts";
import { fmt } from "../api/format";
import type { Series } from "../api/types";
import { buildPoints } from "./chartData";
import { useTokens } from "../components/useTokens";

export function ForecastChart({ series }: { series: Series["data"] }) {
  const t = useTokens();
  const points = buildPoints(series);
  const today = series.history.at(-1)?.date;
  const short = (value: string) => fmt.date(value).replace(/, \d{4}$/, "");
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={t["--line"]} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} tick={{ fill: t["--muted"], fontSize: 11 }} stroke={t["--line"]} minTickGap={28} />
            <YAxis tick={{ fill: t["--muted"], fontSize: 11 }} stroke={t["--line"]} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: t["--surface"], border: `1px solid ${t["--line"]}`, borderRadius: 6, color: t["--ink"] }}
              labelFormatter={(value) => fmt.date(String(value))}
              formatter={(value, name) => [value == null ? "—" : Number(value).toFixed(1), name]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: t["--muted"] }} />
            <Area type="monotone" dataKey="forecast" name="Forecast (28 days)" stroke={t["--accent"]} fill={t["--accent"]} fillOpacity={0.12} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="sold" name="Units sold" stroke={t["--ink"]} strokeWidth={1.5} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="backtest" name="Backtest" stroke={t["--accent"]} strokeDasharray="5 4" strokeWidth={1.5} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="baseline" name="Seasonal naive" stroke={t["--muted"]} strokeDasharray="2 3" strokeWidth={1.2} dot={false} connectNulls={false} />
            <Scatter dataKey="stockout" name="Stockout day" fill={t["--high"]} shape="square" />
            {today && <ReferenceLine x={today} stroke={t["--muted"]} strokeDasharray="4 4" label={{ value: "Today", position: "insideTopRight", fill: t["--muted"], fontSize: 11 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="muted" style={{ fontSize: 12 }}>
        Red squares mark stockout days: sales were zero because the shelf was empty, so they understate real demand.
      </figcaption>
    </figure>
  );
}
