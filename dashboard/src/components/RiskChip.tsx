import type { RiskLevel } from "../api/types";

export function RiskChip({ level }: { level: RiskLevel }) {
  return <span className={`chip ${level.toLowerCase()}`}>{level === "HIGH" ? "High" : level === "MEDIUM" ? "Medium" : "Low"}</span>;
}
