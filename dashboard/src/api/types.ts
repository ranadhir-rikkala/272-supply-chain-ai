export type Role = "VIEWER" | "PLANNER" | "SUPPLY_MANAGER" | "ADMIN";
export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";
export type RecommendationKind = "REORDER" | "TRANSFER";
export type RecommendationStatus = "PENDING_REVIEW" | "PENDING_MANAGER" | "APPROVED" | "REJECTED" | "SUPERSEDED";

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface Me {
  username: string;
  displayName: string;
  email: string | null;
  roles: Role[];
}

export interface Summary {
  optimization: {
    asOfDate: string;
    high: number;
    medium: number;
    overstocked: number;
    reorders: number;
    transfers: number;
  } | null;
  approvals: { pendingReview: number; pendingManager: number; pendingValue: number };
  orders: { purchaseOrders: number; transferOrders: number; value: number };
  model: { modelVersion: string; weeklyWape: number; baselineWeeklyWape: number } | null;
  data: { rowsLoaded: number; rowsQuarantined: number; latestFeed: string | null };
  forecastServiceCircuit: "CLOSED" | "OPEN" | "HALF_OPEN" | string;
}

export interface Warehouse {
  warehouseId: string;
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  high: number;
  medium: number;
  low: number;
  overstocked: number;
  pendingInbound: number;
  pendingOutbound: number;
}

export interface Risk {
  sku: string;
  productName: string;
  categoryCode: string;
  warehouseId: string;
  onHand: number;
  onOrder: number;
  meanDailyDemand: number;
  sdDailyDemand: number;
  leadTimeDays: number;
  daysOfCover: number | null;
  projectedStockoutDate: string | null;
  riskLevel: RiskLevel;
  overstocked: boolean;
  safetyStock: number;
  reorderPoint: number;
}

export interface OpenOrder {
  poId: string;
  orderQty: number;
  orderDate: string;
  promisedDate: string;
  expectedDate: string;
  delayed: boolean;
}

export interface OtherWarehouse {
  warehouseId: string;
  onHand: number;
  riskLevel: RiskLevel;
  daysOfCover: number | null;
  overstocked: boolean;
}

export interface Product {
  sku: string;
  name: string;
  categoryName: string;
  brand: string;
  unitCost: number;
  listPrice: number;
  shelfLifeDays: number | null;
  casePack: number;
  supplierId: string;
  supplierName: string;
  region: string;
  leadTimeMeanDays: number;
  onTimeRate: number;
}

export interface RiskDetail {
  risk: Risk;
  product: Product;
  openOrders: OpenOrder[];
  otherWarehouses: OtherWarehouse[];
}

export interface HistoryPoint {
  date: string;
  units_sold: number;
  promo_flag: boolean;
  stockout_flag: boolean | null;
  on_hand: number | null;
}

export interface BacktestPoint {
  date: string;
  actual: number | null;
  yhat: number;
  baseline: number | null;
}

export interface ForecastPoint {
  date: string;
  yhat: number;
  model_version: string;
}

export interface Series {
  forecastAvailable: boolean;
  reason?: string;
  data: {
    history: HistoryPoint[];
    backtest: BacktestPoint[];
    forecast: ForecastPoint[];
  };
}

export interface Recommendation {
  recommendationId: string;
  kind: RecommendationKind;
  sku: string;
  productName: string;
  warehouseId: string;
  sourceWarehouseId: string | null;
  supplierId: string | null;
  quantity: number;
  unitCost: number;
  totalValue: number;
  freightCost: number | null;
  distanceMiles: number | null;
  leadDays: number;
  expectedArrival: string;
  riskLevel: RiskLevel;
  reason: string;
  status: RecommendationStatus;
  endorsedBy: string | null;
  decidedBy: string | null;
  version: number;
}

export interface RecommendationEvent {
  eventId: number;
  fromStatus: RecommendationStatus | null;
  toStatus: RecommendationStatus;
  actor: string;
  actorRoles: Role[];
  comment: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  createdAt: string;
}

export interface RecommendationDetail {
  recommendation: Recommendation;
  events: RecommendationEvent[];
}

export interface Decision {
  recommendation: Recommendation;
  draftOrderId: string | null;
}

export interface DraftOrder {
  orderId: string;
  kind: "PURCHASE" | "TRANSFER";
  recommendationId: string;
  sku: string;
  productName: string;
  warehouseId: string;
  sourceWarehouseId: string | null;
  supplierId: string | null;
  quantity: number;
  totalValue: number;
  freightCost: number | null;
  expectedArrival: string;
  status: string;
  createdBy: string;
  createdAt: string;
}

export interface AuditEntry {
  auditId: number;
  occurredAt: string;
  actor: string;
  actorRoles: Role[];
  action: string;
  entityType: string;
  entityId: string;
  before: string | null;
  after: string | null;
  requestId: string | null;
}

export interface Setting {
  key: string;
  value: number;
  description: string;
  minValue: number;
  maxValue: number;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface Job {
  kind: "ETL" | "FORECAST" | "OPTIMIZATION" | "TRAINING" | string;
  id: string;
  status: string;
  detail: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface ModelVersion {
  model_version: string;
  algorithm: string;
  status: "CANDIDATE" | "ACTIVE" | "REJECTED" | "RETIRED";
  passed_gate: boolean;
  metrics: {
    weekly: { wape: number; baseline_wape: number };
    daily: { wape: number; baseline_wape: number };
  };
  created_at: string;
  status_changed_by?: string;
  status_reason?: string | null;
}

export interface ModelList {
  items: ModelVersion[];
  limit: number;
  offset: number;
  total: number;
}

export interface OptimizationRunSummary {
  runId: string;
  asOfDate: string;
  modelVersion: string;
  cells: number;
  high: number;
  medium: number;
  overstocked: number;
  reorders: number;
  transfers: number;
  superseded: number;
}

export interface ForecastRun {
  run_id: string;
  model_version: string | null;
  origin_date: string | null;
  horizon_days: number;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  requested_by: string;
  finished_at: string | null;
}

export interface DisruptionResult {
  disruptionId: string;
  kind: string;
  startDate: string;
  endDate: string;
  description: string;
  impactedCells: number;
  flaggedSevenDaysAhead: number;
  share: number;
  medianLeadDays: number | null;
  caught: boolean;
}

export interface Evaluation {
  evaluated: number;
  caught: number;
  withoutStockouts: number;
  impactedCells: number;
  flaggedCells: number;
  cellShare: number;
  disruptions: DisruptionResult[];
}
