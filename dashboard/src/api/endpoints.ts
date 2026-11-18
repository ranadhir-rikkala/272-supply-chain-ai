import { get, query, request } from "./client";
import type {
  AuditEntry,
  Decision,
  DraftOrder,
  Evaluation,
  ForecastRun,
  Job,
  Me,
  ModelList,
  OptimizationRunSummary,
  Page,
  Recommendation,
  RecommendationDetail,
  RecommendationKind,
  Risk,
  RiskDetail,
  RiskLevel,
  Series,
  Setting,
  Summary,
  Warehouse,
} from "./types";

export interface RiskFilters {
  level?: RiskLevel | "";
  warehouseId?: string;
  category?: string;
  search?: string;
  page: number;
  size: number;
}

export interface AuditFilters {
  entityType?: string;
  actor?: string;
  page: number;
  size: number;
}

export const api = {
  me: (signal?: AbortSignal) => get<Me>("/me", signal),
  summary: (signal?: AbortSignal) => get<Summary>("/dashboard/summary", signal),
  warehouses: (signal?: AbortSignal) => get<Warehouse[]>("/warehouses", signal),
  risks: (filters: RiskFilters, signal?: AbortSignal) => get<Page<Risk>>(`/risks${query({ ...filters })}`, signal),
  risk: (sku: string, warehouseId: string, signal?: AbortSignal) =>
    get<RiskDetail>(`/risks/${encodeURIComponent(sku)}/${encodeURIComponent(warehouseId)}`, signal),
  series: (sku: string, warehouseId: string, historyDays: number, signal?: AbortSignal) =>
    get<Series>(`/series/${encodeURIComponent(sku)}/${encodeURIComponent(warehouseId)}${query({ historyDays })}`, signal),
  recommendations: (
    params: { status: string; kind?: RecommendationKind | ""; warehouseId?: string; page: number; size: number },
    signal?: AbortSignal,
  ) => get<Page<Recommendation>>(`/recommendations${query({ ...params })}`, signal),
  recommendation: (id: string, signal?: AbortSignal) => request<RecommendationDetail>(`/recommendations/${id}`, { signal }),
  approve: (id: string, version: number, body: { comment?: string; quantity?: number }) =>
    request<Decision>(`/recommendations/${id}/approve`, {
      method: "POST",
      body,
      ifMatch: version,
      idempotencyKey: crypto.randomUUID(),
    }),
  reject: (id: string, version: number, comment: string) =>
    request<Decision>(`/recommendations/${id}/reject`, {
      method: "POST",
      body: { comment },
      ifMatch: version,
      idempotencyKey: crypto.randomUUID(),
    }),
  orders: (params: { kind?: string; page: number; size: number }, signal?: AbortSignal) =>
    get<Page<DraftOrder>>(`/orders${query({ ...params })}`, signal),
  audit: (filters: AuditFilters, signal?: AbortSignal) => get<Page<AuditEntry>>(`/audit${query({ ...filters })}`, signal),
  settings: (signal?: AbortSignal) => get<Setting[]>("/settings", signal),
  updateSetting: (key: string, value: number, version: number) =>
    request<Setting>(`/settings/${encodeURIComponent(key)}`, { method: "PUT", body: { value }, ifMatch: version }),
  runOptimization: () =>
    request<OptimizationRunSummary>("/optimization-runs", { method: "POST", idempotencyKey: crypto.randomUUID() }),
  requestForecast: () => request<ForecastRun>("/forecast-runs", { method: "POST", idempotencyKey: crypto.randomUUID() }),
  jobs: (signal?: AbortSignal) => get<Job[]>("/jobs?limit=40", signal),
  models: (signal?: AbortSignal) => get<ModelList>("/models", signal),
  activateModel: (version: string, reason: string) =>
    request<unknown>(`/models/${encodeURIComponent(version)}/activation`, {
      method: "POST",
      body: { reason },
      idempotencyKey: crypto.randomUUID(),
    }),
  evaluation: (signal?: AbortSignal) => get<Evaluation>("/evaluation/risk-flags", signal),
  runEvaluation: () =>
    request<Evaluation>("/evaluation/risk-flags", { method: "POST", idempotencyKey: crypto.randomUUID() }),
};
