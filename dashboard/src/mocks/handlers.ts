import { http, HttpResponse, type JsonBodyType } from "msw";
import type { Decision, Recommendation, RecommendationStatus, Role, Summary, Warehouse } from "../api/types";
import { AS_OF, DEMO_USERS, EVALUATION_ROWS, PRODUCTS, WAREHOUSES, freshState, openOrdersFor, seriesFor, type MockState } from "./data";

let state: MockState = freshState();

export function resetMockState() {
  state = freshState();
}

const API = "*/api/v1";

function problem(status: number, title: string, detail: string, path: string) {
  return HttpResponse.json(
    { type: `https://supplychain.local/problems/${title.toLowerCase().replaceAll(" ", "-")}`, title, status, detail, instance: path, requestId: crypto.randomUUID() },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

function userOf(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  const username = header.startsWith("Bearer mock:") ? header.slice("Bearer mock:".length) : null;
  return DEMO_USERS.find((user) => user.username === username) ?? null;
}

type Handler = (args: { request: Request; params: Record<string, string>; user: (typeof DEMO_USERS)[number] }) => Promise<Response> | Response;

function secured(roles: Role[] | "any", handler: Handler) {
  return async ({ request, params }: { request: Request; params: Record<string, string | readonly string[] | undefined> }) => {
    const user = userOf(request);
    const path = new URL(request.url).pathname;
    if (!user) return problem(401, "Unauthorized", "a valid bearer token is required", path);
    if (roles !== "any" && !user.roles.some((role) => roles.includes(role))) {
      return problem(403, "Forbidden", "your role does not allow this action", path);
    }
    return handler({ request, params: params as Record<string, string>, user });
  };
}

function page<T>(items: T[], url: URL, defaultSize = 50) {
  const pageIndex = Number(url.searchParams.get("page") ?? 0);
  const size = Number(url.searchParams.get("size") ?? defaultSize);
  return { items: items.slice(pageIndex * size, pageIndex * size + size), page: pageIndex, size, total: items.length };
}

function audit(user: (typeof DEMO_USERS)[number], action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  state.audit.unshift({
    auditId: state.audit.length + 1,
    occurredAt: new Date().toISOString(),
    actor: user.username,
    actorRoles: user.roles,
    action,
    entityType,
    entityId,
    before: before == null ? null : JSON.stringify(before),
    after: after == null ? null : JSON.stringify(after),
    requestId: crypto.randomUUID(),
  });
}

function view(rec: Recommendation) {
  return { status: rec.status, quantity: rec.quantity, totalValue: rec.totalValue, endorsedBy: rec.endorsedBy, decidedBy: rec.decidedBy, version: rec.version };
}

function plannerLimit() {
  return state.settings.find((setting) => setting.key === "planner_limit_usd")?.value ?? 10000;
}

const OPEN: RecommendationStatus[] = ["PENDING_REVIEW", "PENDING_MANAGER"];
const RISK_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

function ifMatch(request: Request) {
  const header = request.headers.get("If-Match");
  return header == null ? null : Number(header.replaceAll('"', ""));
}

function event(rec: Recommendation, from: RecommendationStatus, user: (typeof DEMO_USERS)[number], comment: string | null, before: number | null, after: number | null) {
  state.eventNumber += 1;
  (state.events[rec.recommendationId] ??= []).push({
    eventId: state.eventNumber,
    fromStatus: from,
    toStatus: rec.status,
    actor: user.username,
    actorRoles: user.roles,
    comment,
    quantityBefore: before,
    quantityAfter: after,
    createdAt: new Date().toISOString(),
  });
}

export const handlers = [
  http.get(`${API}/me`, secured("any", ({ user }) =>
    HttpResponse.json({ username: user.username, displayName: user.displayName, email: `${user.username}@supplychain.local`, roles: user.roles }),
  )),

  http.get(`${API}/dashboard/summary`, secured("any", () => {
    const open = state.recommendations.filter((r) => OPEN.includes(r.status));
    const summary: Summary = {
      optimization: {
        asOfDate: AS_OF,
        high: state.risks.filter((r) => r.riskLevel === "HIGH").length,
        medium: state.risks.filter((r) => r.riskLevel === "MEDIUM").length,
        overstocked: state.risks.filter((r) => r.overstocked).length,
        reorders: state.recommendations.filter((r) => r.kind === "REORDER").length,
        transfers: state.recommendations.filter((r) => r.kind === "TRANSFER").length,
      },
      approvals: {
        pendingReview: open.filter((r) => r.status === "PENDING_REVIEW").length,
        pendingManager: open.filter((r) => r.status === "PENDING_MANAGER").length,
        pendingValue: Math.round(open.reduce((total, r) => total + r.totalValue, 0) * 100) / 100,
      },
      orders: {
        purchaseOrders: state.orders.filter((o) => o.kind === "PURCHASE").length,
        transferOrders: state.orders.filter((o) => o.kind === "TRANSFER").length,
        value: Math.round(state.orders.reduce((total, o) => total + o.totalValue, 0) * 100) / 100,
      },
      model: { modelVersion: state.models.find((m) => m.status === "ACTIVE")!.model_version, weeklyWape: 0.2095, baselineWeeklyWape: 0.2883 },
      data: { rowsLoaded: 9201051 + 8830, rowsQuarantined: 87210 + 8081, latestFeed: AS_OF },
      forecastServiceCircuit: "CLOSED",
    };
    return HttpResponse.json(summary);
  })),

  http.get(`${API}/warehouses`, secured("any", () => {
    const rows: Warehouse[] = WAREHOUSES.map((w) => {
      const cells = state.risks.filter((r) => r.warehouseId === w.warehouseId);
      const transfers = state.recommendations.filter((r) => r.kind === "TRANSFER" && OPEN.includes(r.status));
      return {
        ...w,
        high: cells.filter((r) => r.riskLevel === "HIGH").length,
        medium: cells.filter((r) => r.riskLevel === "MEDIUM").length,
        low: cells.filter((r) => r.riskLevel === "LOW").length,
        overstocked: cells.filter((r) => r.overstocked).length,
        pendingInbound: transfers.filter((r) => r.warehouseId === w.warehouseId).length,
        pendingOutbound: transfers.filter((r) => r.sourceWarehouseId === w.warehouseId).length,
      };
    });
    return HttpResponse.json(rows);
  })),

  http.get(`${API}/risks`, secured("any", ({ request }) => {
    const url = new URL(request.url);
    const level = url.searchParams.get("level");
    const warehouse = url.searchParams.get("warehouseId");
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search")?.toLowerCase();
    const overstocked = url.searchParams.get("overstocked") === "true";
    const rows = state.risks
      .filter((r) => (!level || r.riskLevel === level) && (!warehouse || r.warehouseId === warehouse) && (!category || r.categoryCode === category))
      .filter((r) => !search || r.productName.toLowerCase().includes(search) || r.sku.toLowerCase().includes(search))
      .filter((r) => !overstocked || r.overstocked)
      .sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel] || (a.projectedStockoutDate ?? "9").localeCompare(b.projectedStockoutDate ?? "9") || a.sku.localeCompare(b.sku));
    return HttpResponse.json(page(rows, url));
  })),

  http.get(`${API}/risks/:sku/:warehouseId`, secured("any", ({ request, params }) => {
    const risk = state.risks.find((r) => r.sku === params.sku && r.warehouseId === params.warehouseId);
    if (!risk) return problem(404, "Not Found", `no assessment for ${params.sku} at ${params.warehouseId}`, new URL(request.url).pathname);
    const product = PRODUCTS.find((p) => p.sku === risk.sku)!;
    return HttpResponse.json({
      risk,
      product: {
        sku: product.sku, name: product.name, categoryName: product.categoryName, brand: product.brand, unitCost: product.unitCost,
        listPrice: product.listPrice, shelfLifeDays: product.shelfLifeDays, casePack: product.casePack, supplierId: product.supplierId,
        supplierName: product.supplierName, region: product.region, leadTimeMeanDays: product.leadTimeMeanDays, onTimeRate: product.onTimeRate,
      },
      openOrders: openOrdersFor(risk),
      otherWarehouses: state.risks
        .filter((r) => r.sku === risk.sku && r.warehouseId !== risk.warehouseId)
        .map((r) => ({ warehouseId: r.warehouseId, onHand: r.onHand, riskLevel: r.riskLevel, daysOfCover: r.daysOfCover, overstocked: r.overstocked })),
    });
  })),

  http.get(`${API}/series/:sku/:warehouseId`, secured("any", ({ request, params }) => {
    const days = Number(new URL(request.url).searchParams.get("historyDays") ?? 120);
    const offline = params.sku === "ELE-0381";
    const data = seriesFor(params.sku, params.warehouseId, days);
    return HttpResponse.json(
      offline
        ? { forecastAvailable: false, reason: "forecast service circuit is open; retry in 30 seconds", data: { ...data, backtest: [], forecast: [] } }
        : { forecastAvailable: true, data: { sku: params.sku, warehouseId: params.warehouseId, ...data } },
    );
  })),

  http.get(`${API}/recommendations`, secured("any", ({ request }) => {
    const url = new URL(request.url);
    const statuses = (url.searchParams.get("status") ?? "PENDING_REVIEW,PENDING_MANAGER").split(",");
    const kind = url.searchParams.get("kind");
    const warehouse = url.searchParams.get("warehouseId");
    const rows = state.recommendations
      .filter((r) => statuses.includes(r.status) && (!kind || r.kind === kind))
      .filter((r) => !warehouse || r.warehouseId === warehouse || r.sourceWarehouseId === warehouse)
      .sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel] || b.totalValue - a.totalValue);
    return HttpResponse.json(page(rows, url));
  })),

  http.get(`${API}/recommendations/:id`, secured("any", ({ request, params }) => {
    const rec = state.recommendations.find((r) => r.recommendationId === params.id);
    if (!rec) return problem(404, "Not Found", `recommendation ${params.id} not found`, new URL(request.url).pathname);
    return HttpResponse.json({ recommendation: rec, events: state.events[rec.recommendationId] ?? [] }, { headers: { ETag: `"${rec.version}"` } });
  })),

  http.post(`${API}/recommendations/:id/approve`, secured(["PLANNER", "SUPPLY_MANAGER"], async ({ request, params, user }) => {
    const path = new URL(request.url).pathname;
    const rec = state.recommendations.find((r) => r.recommendationId === params.id);
    if (!rec) return problem(404, "Not Found", `recommendation ${params.id} not found`, path);
    const body = (await request.json().catch(() => ({}))) as { comment?: string; quantity?: number };
    const expected = ifMatch(request);
    if (expected != null && expected !== rec.version) return problem(412, "Precondition Failed", `recommendation changed since version ${expected}; reload and try again`, path);
    if (!OPEN.includes(rec.status)) return problem(409, "Conflict", `recommendation is already ${rec.status}`, path);
    const manager = user.roles.includes("SUPPLY_MANAGER");
    if (body.quantity != null && !manager) return problem(403, "Forbidden", "only a supply manager can change the quantity", path);
    if (rec.status === "PENDING_MANAGER" && !manager) return problem(403, "Forbidden", "this order is above the planner limit and needs a supply manager", path);
    if (manager && rec.endorsedBy === user.username) return problem(403, "Forbidden", "the person who endorsed an order cannot also give final approval", path);
    const before = view(rec);
    const from = rec.status;
    const quantity = body.quantity ?? rec.quantity;
    const value = Math.round(quantity * rec.unitCost * 100) / 100;
    let draftOrderId: string | null = null;
    if (manager || value <= plannerLimit()) {
      rec.status = "APPROVED";
      rec.decidedBy = user.username;
      state.orderNumber += 1;
      draftOrderId = `${rec.kind === "TRANSFER" ? "DTO" : "DPO"}-${String(state.orderNumber).padStart(6, "0")}`;
    } else {
      rec.status = "PENDING_MANAGER";
      rec.endorsedBy = user.username;
    }
    const previousQuantity = rec.quantity;
    rec.quantity = quantity;
    rec.totalValue = value;
    rec.version += 1;
    event(rec, from, user, body.comment ?? null, previousQuantity, quantity);
    if (draftOrderId) {
      state.orders.unshift({
        orderId: draftOrderId, kind: rec.kind === "TRANSFER" ? "TRANSFER" : "PURCHASE", recommendationId: rec.recommendationId, sku: rec.sku,
        productName: rec.productName, warehouseId: rec.warehouseId, sourceWarehouseId: rec.sourceWarehouseId, supplierId: rec.supplierId,
        quantity, totalValue: value, freightCost: rec.freightCost, expectedArrival: rec.expectedArrival, status: "DRAFT",
        createdBy: user.username, createdAt: new Date().toISOString(),
      });
    }
    const action = rec.status === "PENDING_MANAGER" ? "RECOMMENDATION_ENDORSED" : quantity !== previousQuantity ? "RECOMMENDATION_OVERRIDDEN" : "RECOMMENDATION_APPROVED";
    audit(user, action, "recommendation", rec.recommendationId, before, { ...view(rec), draftOrderId, comment: body.comment ?? null });
    const decision: Decision = { recommendation: rec, draftOrderId };
    return HttpResponse.json(decision as unknown as JsonBodyType, { headers: { ETag: `"${rec.version}"` } });
  })),

  http.post(`${API}/recommendations/:id/reject`, secured(["PLANNER", "SUPPLY_MANAGER"], async ({ request, params, user }) => {
    const path = new URL(request.url).pathname;
    const rec = state.recommendations.find((r) => r.recommendationId === params.id);
    if (!rec) return problem(404, "Not Found", `recommendation ${params.id} not found`, path);
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    if (!body.comment?.trim()) return problem(400, "Bad Request", "comment: must not be blank", path);
    const expected = ifMatch(request);
    if (expected != null && expected !== rec.version) return problem(412, "Precondition Failed", `recommendation changed since version ${expected}; reload and try again`, path);
    if (!OPEN.includes(rec.status)) return problem(409, "Conflict", `recommendation is already ${rec.status}`, path);
    if (rec.status === "PENDING_MANAGER" && !user.roles.includes("SUPPLY_MANAGER")) return problem(403, "Forbidden", "only a supply manager can reject an endorsed order", path);
    const before = view(rec);
    const from = rec.status;
    rec.status = "REJECTED";
    rec.decidedBy = user.username;
    rec.version += 1;
    event(rec, from, user, body.comment, null, null);
    audit(user, "RECOMMENDATION_REJECTED", "recommendation", rec.recommendationId, before, { ...view(rec), comment: body.comment });
    return HttpResponse.json({ recommendation: rec, draftOrderId: null } as unknown as JsonBodyType, { headers: { ETag: `"${rec.version}"` } });
  })),

  http.get(`${API}/orders`, secured("any", ({ request }) => {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    return HttpResponse.json(page(state.orders.filter((o) => !kind || o.kind === kind), url));
  })),

  http.get(`${API}/audit`, secured(["SUPPLY_MANAGER", "ADMIN"], ({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get("entityType");
    const actor = url.searchParams.get("actor");
    return HttpResponse.json(page(state.audit.filter((a) => (!type || a.entityType === type) && (!actor || a.actor === actor)), url));
  })),

  http.get(`${API}/settings`, secured("any", () => HttpResponse.json(state.settings))),

  http.put(`${API}/settings/:key`, secured(["ADMIN"], async ({ request, params, user }) => {
    const path = new URL(request.url).pathname;
    const setting = state.settings.find((s) => s.key === params.key);
    if (!setting) return problem(404, "Not Found", `unknown setting ${params.key}`, path);
    const expected = ifMatch(request);
    if (expected != null && expected !== setting.version) return problem(412, "Precondition Failed", `setting ${setting.key} changed since version ${expected}`, path);
    const body = (await request.json()) as { value: number };
    if (typeof body.value !== "number" || body.value < setting.minValue || body.value > setting.maxValue) {
      return problem(400, "Bad Request", `${setting.key} must be between ${setting.minValue} and ${setting.maxValue}`, path);
    }
    audit(user, "SETTING_CHANGED", "setting", setting.key, { value: setting.value }, { value: body.value });
    setting.value = body.value;
    setting.version += 1;
    setting.updatedAt = new Date().toISOString();
    setting.updatedBy = user.username;
    return HttpResponse.json(setting, { headers: { ETag: `"${setting.version}"` } });
  })),

  http.post(`${API}/optimization-runs`, secured(["PLANNER", "ADMIN"], ({ user }) => {
    const superseded = state.recommendations.filter((r) => OPEN.includes(r.status)).length;
    const runId = crypto.randomUUID();
    const summary = {
      runId, asOfDate: AS_OF, modelVersion: state.models.find((m) => m.status === "ACTIVE")!.model_version, cells: state.risks.length,
      high: state.risks.filter((r) => r.riskLevel === "HIGH").length, medium: state.risks.filter((r) => r.riskLevel === "MEDIUM").length,
      overstocked: state.risks.filter((r) => r.overstocked).length, reorders: state.recommendations.filter((r) => r.kind === "REORDER").length,
      transfers: state.recommendations.filter((r) => r.kind === "TRANSFER").length, superseded,
    };
    state.jobs.unshift({ kind: "OPTIMIZATION", id: runId, status: "SUCCEEDED", detail: `as of ${AS_OF} high=${summary.high} reorders=${summary.reorders} transfers=${summary.transfers} by ${user.username}`, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
    audit(user, "OPTIMIZATION_RUN", "optimization_run", runId, null, summary);
    return HttpResponse.json(summary);
  })),

  http.post(`${API}/forecast-runs`, secured(["PLANNER", "ADMIN"], ({ user }) => {
    const runId = crypto.randomUUID();
    const active = state.models.find((m) => m.status === "ACTIVE")!;
    state.jobs.unshift({ kind: "FORECAST", id: runId, status: "QUEUED", detail: `origin=latest by ${user.username}`, startedAt: new Date().toISOString(), finishedAt: null });
    setTimeout(() => {
      const job = state.jobs.find((j) => j.id === runId);
      if (job) {
        job.status = "SUCCEEDED";
        job.detail = `${active.model_version} origin=${AS_OF} by ${user.username}`;
        job.finishedAt = new Date().toISOString();
      }
    }, 2500);
    audit(user, "FORECAST_REQUESTED", "forecast_run", runId, null, { status: "QUEUED" });
    return HttpResponse.json({ run_id: runId, model_version: null, origin_date: null, horizon_days: 28, status: "QUEUED", requested_by: user.username, finished_at: null }, { status: 202 });
  })),

  http.get(`${API}/jobs`, secured("any", () => HttpResponse.json(state.jobs))),

  http.get(`${API}/models`, secured("any", () => HttpResponse.json({ items: state.models, limit: 50, offset: 0, total: state.models.length }))),

  http.post(`${API}/models/:version/activation`, secured(["ADMIN"], async ({ request, params, user }) => {
    const path = new URL(request.url).pathname;
    const model = state.models.find((m) => m.model_version === params.version);
    if (!model) return problem(404, "Not Found", `unknown model version ${params.version}`, path);
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    if (!body.reason || body.reason.trim().length < 3) return problem(400, "Bad Request", "reason: size must be between 3 and 500", path);
    if (!model.passed_gate) return problem(409, "Forecast Service Rejected Request", `${model.model_version} did not pass the quality gate`, path);
    const previous = state.models.find((m) => m.status === "ACTIVE");
    if (previous && previous !== model) {
      previous.status = "RETIRED";
      previous.status_reason = `replaced by ${model.model_version}`;
    }
    model.status = "ACTIVE";
    model.status_changed_by = user.username;
    model.status_reason = body.reason;
    audit(user, "MODEL_ACTIVATED", "model_version", model.model_version, { activeModel: previous?.model_version ?? null }, { activeModel: model.model_version, reason: body.reason });
    return HttpResponse.json(model);
  })),

  http.get(`${API}/evaluation/risk-flags`, secured("any", () => HttpResponse.json(evaluation()))),

  http.post(`${API}/evaluation/risk-flags`, secured(["ADMIN"], ({ user }) => {
    const result = evaluation();
    audit(user, "RISK_EVALUATION_RUN", "evaluation", "risk-flags", null, { evaluated: result.evaluated, caught: result.caught, cellShare: result.cellShare });
    return HttpResponse.json(result);
  })),
];

function evaluation() {
  const impacted = EVALUATION_ROWS.reduce((total, row) => total + row.impactedCells, 0);
  const flagged = EVALUATION_ROWS.reduce((total, row) => total + row.flaggedSevenDaysAhead, 0);
  return {
    evaluated: EVALUATION_ROWS.length,
    caught: EVALUATION_ROWS.filter((row) => row.caught).length,
    withoutStockouts: 0,
    impactedCells: impacted,
    flaggedCells: flagged,
    cellShare: flagged / impacted,
    disruptions: EVALUATION_ROWS,
  };
}
