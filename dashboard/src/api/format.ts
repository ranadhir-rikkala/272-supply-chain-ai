const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const timeFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const fmt = {
  money: (value: number | null | undefined) => (value == null ? "—" : money.format(value)),
  cents: (value: number | null | undefined) => (value == null ? "—" : moneyCents.format(value)),
  int: (value: number | null | undefined) => (value == null ? "—" : integer.format(Math.round(value))),
  pct: (value: number | null | undefined, digits = 1) => (value == null ? "—" : `${(value * 100).toFixed(digits)}%`),
  date: (value: string | null | undefined) => (value ? dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : "—"),
  time: (value: string | null | undefined) => (value ? timeFormat.format(new Date(value)) : "—"),
  status: (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
};
