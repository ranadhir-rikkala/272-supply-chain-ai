import type {
  AuditEntry,
  DisruptionResult,
  DraftOrder,
  Job,
  ModelVersion,
  Recommendation,
  RecommendationEvent,
  Risk,
  RiskLevel,
  Role,
  Setting,
  Warehouse,
} from "../api/types";

export const AS_OF = "2025-12-31";

export const DEMO_USERS: { username: string; displayName: string; roles: Role[] }[] = [
  { username: "vic.viewer", displayName: "Vic Viewer", roles: ["VIEWER"] },
  { username: "pat.planner", displayName: "Pat Planner", roles: ["PLANNER"] },
  { username: "max.manager", displayName: "Max Manager", roles: ["SUPPLY_MANAGER"] },
  { username: "ada.admin", displayName: "Ada Admin", roles: ["ADMIN"] },
];

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const WAREHOUSES = [
  { warehouseId: "WH-ATL", name: "Atlanta DC", city: "Atlanta", state: "GA", latitude: 33.749, longitude: -84.388 },
  { warehouseId: "WH-CHI", name: "Chicago DC", city: "Chicago", state: "IL", latitude: 41.8781, longitude: -87.6298 },
  { warehouseId: "WH-DFW", name: "Dallas DC", city: "Dallas", state: "TX", latitude: 32.7767, longitude: -96.797 },
  { warehouseId: "WH-EWR", name: "Newark DC", city: "Newark", state: "NJ", latitude: 40.7357, longitude: -74.1724 },
  { warehouseId: "WH-LAX", name: "Los Angeles DC", city: "Ontario", state: "CA", latitude: 34.0633, longitude: -117.6509 },
  { warehouseId: "WH-MSP", name: "Minneapolis DC", city: "Minneapolis", state: "MN", latitude: 44.9778, longitude: -93.265 },
  { warehouseId: "WH-PHX", name: "Phoenix DC", city: "Phoenix", state: "AZ", latitude: 33.4484, longitude: -112.074 },
  { warehouseId: "WH-SEA", name: "Seattle DC", city: "Kent", state: "WA", latitude: 47.3809, longitude: -122.2348 },
];

const CATALOG: [string, string, string, number, number, string][] = [
  ["BEV", "Beverages", "Brookline Sparkling Water Lime 12x355ml", 3.28, 14, "US-EAST"],
  ["BEV", "Beverages", "Clearpeak Cold Brew Coffee 8x325ml", 9.4, 9, "US-WEST"],
  ["BEV", "Beverages", "Sunfield Sports Drink 12x591ml", 6.1, 11, "MEXICO"],
  ["BEV", "Beverages", "Brookline Lemonade 1.75L", 2.95, 12, "US-CENTRAL"],
  ["SNK", "Snacks", "Crunchwell Kettle Chips Sea Salt 8oz", 2.4, 13, "US-CENTRAL"],
  ["SNK", "Snacks", "Trailhead Protein Bars 12ct", 8.9, 7, "US-WEST"],
  ["SNK", "Snacks", "Golden Acre Granola Bars 24ct", 6.3, 8, "MEXICO"],
  ["SNK", "Snacks", "Crunchwell Tortilla Chips 20oz", 3.1, 11, "US-EAST"],
  ["DAI", "Dairy", "Meadowvale Whole Milk 1gal", 3.6, 21, "US-CENTRAL"],
  ["DAI", "Dairy", "Clover Ridge Greek Yogurt Plain 32oz", 4.2, 12, "US-EAST"],
  ["DAI", "Dairy", "Pure Pasture Salted Butter 16oz", 4.9, 9, "US-WEST"],
  ["DAI", "Dairy", "Meadowvale Cheddar Cheese 8oz", 3.3, 10, "US-CENTRAL"],
  ["FRZ", "Frozen", "Frostline Pepperoni Pizza 12in", 5.6, 8, "US-CENTRAL"],
  ["FRZ", "Frozen", "Polar Bay Vanilla Ice Cream 1.5qt", 4.4, 9, "US-WEST"],
  ["FRZ", "Frozen", "Hearthstone Chicken Nuggets 2lb", 6.8, 6, "US-EAST"],
  ["FRZ", "Frozen", "Frostline Fruit Ice Pops 24ct", 7.1, 5, "US-CENTRAL"],
  ["PCR", "Personal Care", "Softwater Shampoo 28oz", 6.2, 6, "US-EAST"],
  ["PCR", "Personal Care", "Bloomwell Sunscreen SPF 50 8oz", 8.4, 5, "MEXICO"],
  ["PCR", "Personal Care", "Everfresh Toothpaste 2x6oz", 4.1, 7, "US-WEST"],
  ["PCR", "Personal Care", "Softwater Body Wash 32oz", 7.3, 5, "US-CENTRAL"],
  ["HHC", "Household Cleaning", "Brightway Laundry Detergent 128 Loads", 14.5, 5, "US-CENTRAL"],
  ["HHC", "Household Cleaning", "Tidy Home Disinfecting Wipes 3x80ct", 9.2, 7, "US-EAST"],
  ["HHC", "Household Cleaning", "Clearsweep Dishwasher Pods 90ct", 13.8, 4, "US-WEST"],
  ["HHC", "Household Cleaning", "Brightway Dish Soap 38oz", 4.6, 6, "US-CENTRAL"],
  ["PAP", "Paper Goods", "Cloudsoft Toilet Paper 24 Rolls", 16.2, 8, "US-EAST"],
  ["PAP", "Paper Goods", "Plushpak Paper Towels 12 Rolls", 15.4, 7, "US-CENTRAL"],
  ["PAP", "Paper Goods", "Everroll Facial Tissue 8 Boxes", 9.8, 5, "US-WEST"],
  ["PAP", "Paper Goods", "Cloudsoft Kitchen Trash Bags 90ct", 11.9, 4, "US-CENTRAL"],
  ["ELE", "Small Electronics", "Voltix Wireless Earbuds Pro", 41.2, 2, "CHINA"],
  ["ELE", "Small Electronics", "Soundcrest Bluetooth Speaker Mini", 22.6, 2, "VIETNAM"],
  ["ELE", "Small Electronics", "Arcline Power Bank 20000mAh", 18.3, 3, "CHINA"],
  ["ELE", "Small Electronics", "Voltix USB-C Wall Charger 65W", 15.7, 3, "VIETNAM"],
  ["PHA", "Phone Accessories", "Shieldo Phone Case 6.7in", 4.9, 4, "CHINA"],
  ["PHA", "Phone Accessories", "Gripline Screen Protector 2pk 6.1in", 3.2, 5, "VIETNAM"],
  ["PHA", "Phone Accessories", "Chargeway Magnetic Wireless Charger 15W", 11.4, 3, "CHINA"],
  ["PHA", "Phone Accessories", "Shieldo USB-C Cable 2m", 2.8, 5, "VIETNAM"],
  ["OUT", "Outdoor & Summer", "Breezeline Box Fan 20in", 21.5, 2, "CHINA"],
  ["OUT", "Outdoor & Summer", "Campfield Rolling Cooler 60qt", 38.2, 1, "MEXICO"],
  ["OUT", "Outdoor & Summer", "Sunporch Garden Hose 100ft", 24.9, 1, "CHINA"],
  ["OUT", "Outdoor & Summer", "Breezeline Tower Fan 42in", 33.4, 1, "MEXICO"],
  ["WIN", "Winter", "Warmhaven Space Heater 1500W Ceramic", 27.8, 4, "CHINA"],
  ["WIN", "Winter", "Frostguard Hand Warmers 40pk", 12.6, 5, "US-CENTRAL"],
  ["WIN", "Winter", "Emberlite Electric Blanket Queen", 39.5, 2, "CHINA"],
  ["WIN", "Winter", "Frostguard Snow Shovel 24in", 18.9, 3, "US-CENTRAL"],
  ["SCH", "School & Office", "Inkwell Spiral Notebook 3-Subject", 2.1, 6, "CHINA"],
  ["SCH", "School & Office", "Paperline Ballpoint Pens 24pk", 3.4, 5, "MEXICO"],
  ["SCH", "School & Office", "Scribely Copy Paper 5 Reams", 18.6, 4, "US-EAST"],
  ["SCH", "School & Office", "Inkwell Highlighters 10pk", 4.3, 4, "CHINA"],
];

const LEAD: Record<string, number> = { "US-EAST": 4.6, "US-WEST": 4.2, "US-CENTRAL": 3.9, MEXICO: 11.2, CHINA: 36.4, VIETNAM: 38.9 };
const SUPPLIER_NAMES: Record<string, string> = {
  "US-EAST": "Harbor Inlet Supply",
  "US-WEST": "Juniper Provisions",
  "US-CENTRAL": "Prairie Mesa Goods",
  MEXICO: "Cobalt Trading Co.",
  CHINA: "Ember Manufacturing",
  VIETNAM: "Tidewater Industries",
};
const SUPPLIER_IDS: Record<string, string> = {
  "US-EAST": "SUP-012",
  "US-WEST": "SUP-018",
  "US-CENTRAL": "SUP-027",
  MEXICO: "SUP-033",
  CHINA: "SUP-041",
  VIETNAM: "SUP-047",
};

export interface MockProduct {
  sku: string;
  name: string;
  categoryCode: string;
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
  baseDemand: number;
}

export const PRODUCTS: MockProduct[] = CATALOG.map(([code, category, name, cost, demand, region], index) => ({
  sku: `${code}-${String(101 + index * 10).padStart(4, "0")}`,
  name,
  categoryCode: code,
  categoryName: category,
  brand: name.split(" ")[0],
  unitCost: cost,
  listPrice: Math.round(cost * 1.6 * 100) / 100,
  shelfLifeDays: code === "DAI" ? 14 : code === "BEV" ? 270 : code === "FRZ" ? 240 : null,
  casePack: cost > 20 ? 2 : cost > 8 ? 6 : 12,
  supplierId: SUPPLIER_IDS[region],
  supplierName: SUPPLIER_NAMES[region],
  region,
  leadTimeMeanDays: LEAD[region],
  onTimeRate: region === "CHINA" || region === "VIETNAM" ? 0.82 : 0.95,
  baseDemand: demand,
}));

const WAREHOUSE_SCALE: Record<string, number> = {
  "WH-ATL": 1.1, "WH-CHI": 1.3, "WH-DFW": 1.2, "WH-EWR": 1.4, "WH-LAX": 1.4, "WH-MSP": 0.8, "WH-PHX": 0.8, "WH-SEA": 0.9,
};

function riskFor(product: MockProduct, warehouseId: string, random: () => number): RiskLevel {
  const cold = ["WH-MSP", "WH-CHI", "WH-EWR"].includes(warehouseId);
  let pressure = random();
  if (product.categoryCode === "WIN" && cold) pressure += 0.55;
  if (product.categoryCode === "ELE" || product.categoryCode === "PHA") pressure += 0.3;
  if (product.categoryCode === "OUT") pressure -= 0.3;
  if (pressure > 0.92) return "HIGH";
  if (pressure > 0.78) return "MEDIUM";
  return "LOW";
}

export function buildRisks(): Risk[] {
  const random = rng(272);
  const rows: Risk[] = [];
  for (const product of PRODUCTS) {
    for (const warehouse of WAREHOUSES) {
      const mean = product.baseDemand * 2.5 * WAREHOUSE_SCALE[warehouse.warehouseId] * (0.8 + random() * 0.5);
      const level = riskFor(product, warehouse.warehouseId, random);
      const lead = product.leadTimeMeanDays;
      const days =
        level === "HIGH" ? Math.floor(random() * Math.max(1, lead - 1)) : level === "MEDIUM" ? Math.ceil(lead) + Math.floor(random() * 5) : null;
      const overstocked = level === "LOW" && product.categoryCode === "OUT" && random() > 0.55;
      const cover = days ?? (overstocked ? 95 + Math.floor(random() * 60) : Math.ceil(lead) + 12 + Math.floor(random() * 30));
      const onHand = Math.max(0, Math.round(mean * cover));
      const sd = mean * (0.3 + random() * 0.25);
      const safety = 1.65 * Math.sqrt(lead * sd * sd + mean * mean * 2);
      rows.push({
        sku: product.sku,
        productName: product.name,
        categoryCode: product.categoryCode,
        warehouseId: warehouse.warehouseId,
        onHand,
        onOrder: level === "LOW" ? 0 : Math.round(mean * lead * random()),
        meanDailyDemand: Math.round(mean * 1000) / 1000,
        sdDailyDemand: Math.round(sd * 1000) / 1000,
        leadTimeDays: lead,
        daysOfCover: days,
        projectedStockoutDate: days == null ? null : addDays(AS_OF, days + 1),
        riskLevel: level,
        overstocked,
        safetyStock: Math.round(safety * 10) / 10,
        reorderPoint: Math.round((mean * lead + safety) * 10) / 10,
      });
    }
  }
  return rows;
}

const RADIUS = 3958.8;
export function miles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return RADIUS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function buildRecommendations(risks: Risk[]): Recommendation[] {
  const random = rng(4040);
  const recs: Recommendation[] = [];
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const product = (sku: string) => PRODUCTS.find((p) => p.sku === sku)!;
  for (const risk of risks.filter((r) => r.riskLevel !== "LOW")) {
    const p = product(risk.sku);
    const cover = Math.ceil(p.leadTimeMeanDays) + 21;
    const quantity = Math.max(p.casePack, Math.ceil((risk.meanDailyDemand * cover + risk.safetyStock - risk.onHand - risk.onOrder) / p.casePack) * p.casePack);
    const lead = Math.ceil(p.leadTimeMeanDays);
    recs.push({
      recommendationId: id(),
      kind: "REORDER",
      sku: risk.sku,
      productName: risk.productName,
      warehouseId: risk.warehouseId,
      sourceWarehouseId: null,
      supplierId: p.supplierId,
      quantity,
      unitCost: p.unitCost,
      totalValue: Math.round(quantity * p.unitCost * 100) / 100,
      freightCost: null,
      distanceMiles: null,
      leadDays: lead,
      expectedArrival: addDays(AS_OF, lead),
      riskLevel: risk.riskLevel,
      reason:
        risk.daysOfCover != null
          ? `Projected stockout in ${risk.daysOfCover + 1} days (${risk.projectedStockoutDate}); supplier lead time ${lead} days. Position ${risk.onHand + risk.onOrder} vs reorder point ${Math.round(risk.reorderPoint)}.`
          : `Inventory position ${risk.onHand + risk.onOrder} is below reorder point ${Math.round(risk.reorderPoint)}; supplier lead time ${lead} days.`,
      status: "PENDING_REVIEW",
      endorsedBy: null,
      decidedBy: null,
      version: 0,
    });
  }
  const highs = risks.filter((r) => r.riskLevel === "HIGH" && product(r.sku).leadTimeMeanDays > 8);
  for (const target of highs.slice(0, 14)) {
    const donors = risks
      .filter((r) => r.sku === target.sku && r.riskLevel === "LOW" && !r.overstocked && r.warehouseId !== target.warehouseId)
      .map((r) => ({ r, w: WAREHOUSES.find((w) => w.warehouseId === r.warehouseId)! }))
      .sort((a, b) => miles(a.w, WAREHOUSES.find((w) => w.warehouseId === target.warehouseId)!) - miles(b.w, WAREHOUSES.find((w) => w.warehouseId === target.warehouseId)!));
    const donor = donors[0];
    if (!donor) continue;
    const p = product(target.sku);
    const destination = WAREHOUSES.find((w) => w.warehouseId === target.warehouseId)!;
    const distance = miles(donor.w, destination);
    const transit = 1 + Math.ceil(distance / 500);
    const quantity = Math.max(p.casePack, Math.round((target.meanDailyDemand * (p.leadTimeMeanDays - (target.daysOfCover ?? 0))) / p.casePack) * p.casePack);
    recs.push({
      recommendationId: id(),
      kind: "TRANSFER",
      sku: target.sku,
      productName: target.productName,
      warehouseId: target.warehouseId,
      sourceWarehouseId: donor.r.warehouseId,
      supplierId: null,
      quantity,
      unitCost: p.unitCost,
      totalValue: Math.round(quantity * p.unitCost * 100) / 100,
      freightCost: Math.round((150 + 0.0006 * quantity * distance) * 100) / 100,
      distanceMiles: Math.round(distance * 10) / 10,
      leadDays: transit,
      expectedArrival: addDays(AS_OF, transit),
      riskLevel: "HIGH",
      reason: `Stockout in ${(target.daysOfCover ?? 0) + 1} days at ${target.warehouseId}. Move ${quantity} units from ${donor.r.warehouseId} (${Math.round(distance)} miles, ${transit} days by truck) instead of waiting ${Math.ceil(p.leadTimeMeanDays)} days for the supplier.`,
      status: "PENDING_REVIEW",
      endorsedBy: null,
      decidedBy: null,
      version: 0,
    });
    if (random() > 2) break;
  }
  return recs;
}

export const SETTINGS: Setting[] = [
  ["freight_fixed_usd", 150, "Fixed cost per transfer shipment", 0, 5000],
  ["freight_per_unit_mile_usd", 0.0006, "Variable transfer cost per unit per mile", 0, 1],
  ["overstock_days", 90, "Days of cover above which a cell is overstocked", 30, 365],
  ["planner_limit_usd", 10000, "Largest order value a planner may approve alone", 0, 1000000],
  ["review_days", 7, "Days between reorder reviews", 1, 30],
  ["safety_days", 5, "Extra days of cover before a cell is MEDIUM risk", 0, 30],
  ["service_level_z", 1.65, "Safety stock z-score (1.65 = 95% cycle service level)", 0.5, 3.5],
  ["transfer_miles_per_day", 500, "Truck miles covered per transit day", 100, 1500],
].map(([key, value, description, minValue, maxValue]) => ({
  key: key as string,
  value: value as number,
  description: description as string,
  minValue: minValue as number,
  maxValue: maxValue as number,
  version: 0,
  updatedAt: "2025-12-31T08:00:00Z",
  updatedBy: "system",
}));

export const MODELS: ModelVersion[] = [
  {
    model_version: "demand-xgb-20251231-230222",
    algorithm: "xgboost-tweedie-recursive",
    status: "ACTIVE",
    passed_gate: true,
    metrics: { weekly: { wape: 0.2095, baseline_wape: 0.2883 }, daily: { wape: 0.4164, baseline_wape: 0.581 } },
    created_at: "2025-12-31T23:02:22Z",
    status_changed_by: "rik",
    status_reason: "promoted after training",
  },
  {
    model_version: "demand-xgb-20251231-230125",
    algorithm: "xgboost-tweedie-recursive",
    status: "RETIRED",
    passed_gate: true,
    metrics: { weekly: { wape: 0.209, baseline_wape: 0.2883 }, daily: { wape: 0.416, baseline_wape: 0.581 } },
    created_at: "2025-12-31T23:01:25Z",
    status_changed_by: "rik",
    status_reason: "replaced by demand-xgb-20251231-230222",
  },
  {
    model_version: "demand-xgb-20251230-180410",
    algorithm: "xgboost-tweedie-recursive",
    status: "REJECTED",
    passed_gate: false,
    metrics: { weekly: { wape: 0.312, baseline_wape: 0.2883 }, daily: { wape: 0.55, baseline_wape: 0.581 } },
    created_at: "2025-12-30T18:04:10Z",
    status_changed_by: "rik",
    status_reason: "failed quality gate",
  },
];

const DISRUPTIONS: [string, string, string, string, string, number, number, number | null][] = [
  ["DIS-004", "SUPPLIER_DELAY", "2023-09-19", "2023-10-08", "Ember Provisions (CHINA) production stoppage, backlog 7 days", 77, 61, 9],
  ["DIS-006", "SUPPLIER_DELAY", "2023-10-10", "2023-10-30", "Alder Supply (US-WEST) production stoppage, backlog 14 days", 24, 23, 32],
  ["DIS-007", "SUPPLIER_DELAY", "2023-10-16", "2023-11-02", "Quarry Goods (MEXICO) production stoppage, backlog 9 days", 10, 6, 8],
  ["DIS-009", "SUPPLIER_DELAY", "2023-12-17", "2024-01-05", "Halcyon Trading Co. (CHINA) production stoppage, backlog 12 days", 38, 28, 8],
  ["DIS-010", "SUPPLIER_DELAY", "2024-02-20", "2024-03-12", "Basin Industries (VIETNAM) production stoppage, backlog 15 days", 43, 31, 14],
  ["DIS-012", "PORT_CLOSURE", "2024-09-04", "2024-09-19", "West Coast port closure holds Asia ocean freight, backlog 18 days", 749, 566, 11],
  ["DIS-016", "SUPPLIER_DELAY", "2025-04-11", "2025-05-02", "Kestrel Manufacturing (CHINA) production stoppage, backlog 10 days", 48, 37, 14],
  ["DIS-018", "SUPPLIER_DELAY", "2025-05-08", "2025-05-30", "Larkspur Supply (US-CENTRAL) production stoppage, backlog 16 days", 53, 45, 16],
  ["DIS-019", "SUPPLIER_DELAY", "2025-05-18", "2025-06-04", "Norland Goods (CHINA) production stoppage, backlog 7 days", 83, 61, 8],
  ["DIS-021", "SUPPLIER_DELAY", "2025-07-09", "2025-07-27", "Orchard Provisions (MEXICO) production stoppage, backlog 11 days", 42, 37, 10],
  ["DIS-022", "SUPPLIER_DELAY", "2025-07-11", "2025-08-02", "Palisade Industries (VIETNAM) production stoppage, backlog 13 days", 61, 43, 15],
  ["DIS-023", "SUPPLIER_DELAY", "2025-07-13", "2025-07-30", "Ridgeline Trading Co. (CHINA) production stoppage, backlog 9 days", 71, 52, 9],
  ["DIS-028", "SUPPLIER_DELAY", "2025-08-20", "2025-09-08", "Saltmarsh Goods (US-EAST) production stoppage, backlog 8 days", 45, 28, 9],
  ["DIS-029", "PORT_CLOSURE", "2025-08-22", "2025-09-05", "West Coast port closure holds Asia ocean freight, backlog 21 days", 742, 593, 14],
  ["DIS-030", "PORT_CLOSURE", "2025-09-06", "2025-09-17", "West Coast port closure holds Asia ocean freight, backlog 12 days", 599, 378, 10],
  ["DIS-032", "PORT_CLOSURE", "2025-09-23", "2025-10-01", "West Coast port closure holds Asia ocean freight, backlog 11 days", 261, 153, 9],
  ["DIS-033", "SUPPLIER_DELAY", "2025-10-06", "2025-10-24", "Mesa Supply (MEXICO) production stoppage, backlog 10 days", 23, 18, 10],
  ["DIS-035", "PORT_CLOSURE", "2025-11-10", "2025-11-26", "West Coast port closure holds Asia ocean freight, backlog 20 days", 805, 685, 18],
  ["DIS-038", "SUPPLIER_DELAY", "2025-12-01", "2025-12-20", "Inlet Manufacturing (CHINA) production stoppage, backlog 12 days", 43, 8, 5],
];

export const EVALUATION_ROWS: DisruptionResult[] = DISRUPTIONS.map(([disruptionId, kind, startDate, endDate, description, impacted, flagged, lead]) => ({
  disruptionId,
  kind,
  startDate,
  endDate,
  description,
  impactedCells: impacted,
  flaggedSevenDaysAhead: flagged,
  share: flagged / impacted,
  medianLeadDays: lead,
  caught: flagged / impacted >= 0.5,
}));

export const SEED_JOBS: Job[] = [
  { kind: "OPTIMIZATION", id: "4a944545-2910-431b-b3d2-8319bd47a0f5", status: "SUCCEEDED", detail: "as of 2025-12-31 high=667 reorders=826 transfers=182 by pat.planner", startedAt: "2025-12-31T23:10:02Z", finishedAt: "2025-12-31T23:10:05Z" },
  { kind: "FORECAST", id: "fd8ac1b7-b70a-4141-8a7e-9bde0b6eed44", status: "SUCCEEDED", detail: "demand-xgb-20251231-230222 origin=2025-12-31 by rik", startedAt: "2025-12-31T23:03:10Z", finishedAt: "2025-12-31T23:03:21Z" },
  { kind: "TRAINING", id: "demand-xgb-20251231-230222", status: "ACTIVE", detail: "weekly WAPE 0.2095 vs baseline 0.2883", startedAt: "2025-12-31T23:02:22Z", finishedAt: "2025-12-31T23:02:22Z" },
  { kind: "ETL", id: "b51c2d1e-6f0a-4c7f-9a52-0f7e1c9d2a11", status: "SUCCEEDED", detail: "erp-daily 2025-12-31 rows=8382 quarantined=81", startedAt: "2025-12-31T22:36:41Z", finishedAt: "2025-12-31T22:36:42Z" },
  { kind: "ETL", id: "c2a1f8b9-1d3e-4b6a-8c0f-5e4d3c2b1a00", status: "PARTIAL", detail: "erp-daily 2025-03-18 rows=4106 quarantined=4002", startedAt: "2025-12-31T22:35:12Z", finishedAt: "2025-12-31T22:35:13Z" },
];

export const SEED_AUDIT: AuditEntry[] = [
  {
    auditId: 1,
    occurredAt: "2025-12-31T23:10:05Z",
    actor: "pat.planner",
    actorRoles: ["PLANNER"],
    action: "OPTIMIZATION_RUN",
    entityType: "optimization_run",
    entityId: "4a944545-2910-431b-b3d2-8319bd47a0f5",
    before: null,
    after: JSON.stringify({ asOfDate: AS_OF, high: 667, medium: 320, reorders: 826, transfers: 182 }),
    requestId: "b14d69b2-e083-4e38-b202-6091f6cbfd37",
  },
];

export function seriesFor(sku: string, warehouseId: string, historyDays: number) {
  const product = PRODUCTS.find((p) => p.sku === sku);
  const seed = [...`${sku}${warehouseId}`].reduce((total, c) => total + c.charCodeAt(0), 0);
  const random = rng(seed);
  const base = (product?.baseDemand ?? 8) * (WAREHOUSE_SCALE[warehouseId] ?? 1);
  const seasonal = (offset: number) => {
    const day = new Date(`${addDays(AS_OF, offset)}T00:00:00Z`);
    const doy = Math.floor((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 0)) / 86400000);
    const weekly = [0.95, 0.9, 0.93, 0.98, 1.1, 1.2, 0.97][(day.getUTCDay() + 6) % 7];
    const code = product?.categoryCode ?? "SNK";
    let yearly = 1;
    if (code === "WIN") yearly = 1 + 1.4 * Math.pow((1 + Math.cos((2 * Math.PI * (doy - 15)) / 365.25)) / 2, 2);
    if (code === "OUT" || code === "BEV") yearly = 1 + 0.9 * Math.pow((1 + Math.cos((2 * Math.PI * (doy - 196)) / 365.25)) / 2, 2);
    if (code === "ELE") yearly = 1 + 1.8 * Math.exp(-0.5 * Math.pow((doy - 333) / 6, 2)) + 0.6 * Math.exp(-0.5 * Math.pow((doy - 353) / 6, 2));
    return base * weekly * yearly;
  };
  const stockoutStart = historyDays - 6 - Math.floor(random() * 10);
  const history = [];
  for (let i = historyDays - 1; i >= 0; i--) {
    const offset = -i;
    const index = historyDays - 1 - i;
    const demand = Math.max(0, Math.round(seasonal(offset) * (0.75 + random() * 0.5)));
    const stockout = sku.startsWith("WIN") && index >= stockoutStart && index < stockoutStart + 5;
    history.push({
      date: addDays(AS_OF, offset),
      units_sold: stockout ? 0 : demand,
      promo_flag: index % 49 < 7,
      stockout_flag: stockout,
      on_hand: stockout ? 0 : Math.round(base * (8 + random() * 20)),
    });
  }
  const backtest = history.slice(-Math.min(historyDays, 56)).map((point, i) => {
    const offset = -(Math.min(historyDays, 56) - 1 - i);
    return {
      date: point.date,
      actual: point.units_sold,
      yhat: Math.round(seasonal(offset) * (0.92 + random() * 0.16) * 1000) / 1000,
      baseline: Math.round(seasonal(offset - 364) * (0.7 + random() * 0.6) * 1000) / 1000,
    };
  });
  const forecast = Array.from({ length: 28 }, (_, i) => ({
    date: addDays(AS_OF, i + 1),
    yhat: Math.round(seasonal(i + 1) * 1000) / 1000,
    model_version: MODELS[0].model_version,
  }));
  return { history, backtest, forecast };
}

export function openOrdersFor(risk: Risk) {
  if (risk.onOrder <= 0) return [];
  const product = PRODUCTS.find((p) => p.sku === risk.sku)!;
  const lead = Math.round(product.leadTimeMeanDays);
  const delayed = risk.riskLevel === "HIGH" && lead > 8;
  const orderDate = addDays(AS_OF, -Math.max(2, lead - 6));
  const number = [...`${risk.sku}${risk.warehouseId}`].reduce((total, c) => total * 31 + c.charCodeAt(0), 7) % 99999;
  return [
    {
      poId: `PO-${orderDate.replaceAll("-", "")}-${String(number).padStart(5, "0")}`,
      orderQty: risk.onOrder,
      orderDate,
      promisedDate: addDays(AS_OF, 6),
      expectedDate: addDays(AS_OF, delayed ? 20 : 6),
      delayed,
    },
  ];
}

export interface MockState {
  risks: Risk[];
  recommendations: Recommendation[];
  events: Record<string, RecommendationEvent[]>;
  orders: DraftOrder[];
  audit: AuditEntry[];
  settings: Setting[];
  models: ModelVersion[];
  jobs: Job[];
  orderNumber: number;
  eventNumber: number;
}

export function freshState(): MockState {
  const risks = buildRisks();
  return {
    risks,
    recommendations: buildRecommendations(risks),
    events: {},
    orders: [],
    audit: SEED_AUDIT.map((entry) => ({ ...entry })),
    settings: SETTINGS.map((setting) => ({ ...setting })),
    models: MODELS.map((model) => ({ ...model })),
    jobs: SEED_JOBS.map((job) => ({ ...job })),
    orderNumber: 0,
    eventNumber: 0,
  };
}

export const warehouseList = (): Omit<Warehouse, "high" | "medium" | "low" | "overstocked" | "pendingInbound" | "pendingOutbound">[] => WAREHOUSES;
