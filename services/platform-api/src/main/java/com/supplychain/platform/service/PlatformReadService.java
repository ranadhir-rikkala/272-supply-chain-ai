package com.supplychain.platform.service;

import com.supplychain.platform.api.ApiException;
import com.supplychain.platform.api.PageResponse;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class PlatformReadService {
    private static final List<String> RISK_LEVELS = List.of("HIGH", "MEDIUM", "LOW");
    private final JdbcClient jdbc;
    private final ForecastClient forecastClient;

    public PlatformReadService(JdbcClient jdbc, ForecastClient forecastClient) {
        this.jdbc = jdbc;
        this.forecastClient = forecastClient;
    }

    public Map<String, Object> summary() {
        Map<String, Object> optimization = jdbc.sql("""
                WITH latest AS (
                    SELECT run_id, as_of_date, model_version
                    FROM app.optimization_run
                    WHERE status = 'SUCCEEDED'
                    ORDER BY finished_at DESC LIMIT 1
                )
                SELECT latest.as_of_date AS "asOfDate", latest.model_version AS "modelVersion",
                    count(*) FILTER (WHERE risk_level = 'HIGH') AS high,
                    count(*) FILTER (WHERE risk_level = 'MEDIUM') AS medium,
                    count(*) FILTER (WHERE overstocked) AS overstocked
                FROM latest LEFT JOIN app.risk_assessment a ON a.run_id = latest.run_id
                GROUP BY latest.as_of_date, latest.model_version
                """)
                .query((rs, row) -> {
                    Map<String, Object> result = new java.util.LinkedHashMap<>();
                    result.put("asOfDate", rs.getObject("asOfDate"));
                    result.put("modelVersion", rs.getString("modelVersion"));
                    result.put("high", rs.getLong("high"));
                    result.put("medium", rs.getLong("medium"));
                    result.put("overstocked", rs.getLong("overstocked"));
                    return result;
                })
                .optional()
                .orElse(null);
        Map<String, Object> approvals = jdbc.sql("""
                SELECT count(*) FILTER (WHERE status = 'PENDING_REVIEW') AS "pendingReview",
                       count(*) FILTER (WHERE status = 'PENDING_MANAGER') AS "pendingManager",
                       COALESCE(sum(quantity * unit_cost + COALESCE(freight_cost, 0))
                           FILTER (WHERE status IN ('PENDING_REVIEW', 'PENDING_MANAGER')), 0) AS "pendingValue"
                FROM app.recommendation
                """)
                .query((rs, row) -> Map.<String, Object>of(
                        "pendingReview", rs.getLong("pendingReview"),
                        "pendingManager", rs.getLong("pendingManager"),
                        "pendingValue", rs.getBigDecimal("pendingValue")))
                .single();
        Map<String, Object> orders = jdbc.sql("""
                SELECT count(*) FILTER (WHERE kind = 'PURCHASE') AS "purchaseOrders",
                       count(*) FILTER (WHERE kind = 'TRANSFER') AS "transferOrders",
                       COALESCE(sum(total_value), 0) AS value
                FROM app.draft_order
                """)
                .query((rs, row) -> Map.<String, Object>of(
                        "purchaseOrders", rs.getLong("purchaseOrders"),
                        "transferOrders", rs.getLong("transferOrders"),
                        "value", rs.getBigDecimal("value")))
                .single();
        Map<String, Object> model = jdbc.sql("""
                SELECT model_version AS "modelVersion",
                       (metrics->'weekly'->>'wape')::double precision AS "weeklyWape",
                       (metrics->'weekly'->>'baseline_wape')::double precision AS "baselineWeeklyWape"
                FROM ml.model_version WHERE status = 'ACTIVE'
                """)
                .query((rs, row) -> {
                    var result = new java.util.LinkedHashMap<String, Object>();
                    result.put("modelVersion", rs.getString("modelVersion"));
                    result.put("weeklyWape", rs.getObject("weeklyWape"));
                    result.put("baselineWeeklyWape", rs.getObject("baselineWeeklyWape"));
                    return result;
                })
                .optional()
                .orElse(null);
        Map<String, Object> data = jdbc.sql("""
                SELECT COALESCE(sum(good_count), 0) AS "rowsLoaded",
                       COALESCE(sum(bad_count), 0) AS "rowsQuarantined",
                       max(feed_date) AS "latestFeed"
                FROM ops.etl_file
                """)
                .query((rs, row) -> Map.<String, Object>of(
                        "rowsLoaded", rs.getLong("rowsLoaded"),
                        "rowsQuarantined", rs.getLong("rowsQuarantined"),
                        "latestFeed", rs.getObject("latestFeed") == null ? "" : rs.getObject("latestFeed")))
                .single();
        if ("".equals(data.get("latestFeed"))) {
            data = new java.util.LinkedHashMap<>(data);
            data.put("latestFeed", null);
        }
        Map<String, Object> resultOptimization = null;
        if (optimization != null) {
            Map<String, Object> counts = jdbc.sql("""
                    SELECT count(*) FILTER (WHERE kind = 'REORDER') AS reorders,
                           count(*) FILTER (WHERE kind = 'TRANSFER') AS transfers
                    FROM app.recommendation WHERE run_id = (
                        SELECT run_id FROM app.optimization_run WHERE status = 'SUCCEEDED'
                        ORDER BY finished_at DESC LIMIT 1)
                    """)
                    .query((rs, row) -> Map.<String, Object>of(
                            "reorders", rs.getLong("reorders"), "transfers", rs.getLong("transfers")))
                    .single();
            resultOptimization = new java.util.LinkedHashMap<>(optimization);
            resultOptimization.putAll(counts);
            resultOptimization.remove("modelVersion");
        }
        var summary = new java.util.LinkedHashMap<String, Object>();
        summary.put("optimization", resultOptimization);
        summary.put("approvals", approvals);
        summary.put("orders", orders);
        summary.put("model", model);
        summary.put("data", data);
        summary.put("forecastServiceCircuit", forecastClient.circuitState());
        return summary;
    }

    public List<Map<String, Object>> warehouses() {
        return jdbc.sql("""
                WITH latest AS (
                    SELECT run_id FROM app.optimization_run WHERE status = 'SUCCEEDED'
                    ORDER BY finished_at DESC LIMIT 1
                ),
                risks AS (
                    SELECT a.warehouse_id,
                        count(*) FILTER (WHERE a.risk_level = 'HIGH') AS high,
                        count(*) FILTER (WHERE a.risk_level = 'MEDIUM') AS medium,
                        count(*) FILTER (WHERE a.risk_level = 'LOW') AS low,
                        count(*) FILTER (WHERE a.overstocked) AS overstocked
                    FROM app.risk_assessment a JOIN latest l ON l.run_id = a.run_id
                    GROUP BY a.warehouse_id
                ),
                open_transfers AS (
                    SELECT warehouse_id, source_warehouse_id
                    FROM app.recommendation
                    WHERE kind = 'TRANSFER' AND status IN ('PENDING_REVIEW', 'PENDING_MANAGER')
                ),
                inbound AS (
                    SELECT warehouse_id, count(*) AS quantity
                    FROM open_transfers GROUP BY warehouse_id
                ),
                outbound AS (
                    SELECT source_warehouse_id AS warehouse_id, count(*) AS quantity
                    FROM open_transfers GROUP BY source_warehouse_id
                )
                SELECT w.warehouse_id AS "warehouseId", w.warehouse_name AS name, w.city,
                    '' AS state, w.latitude, w.longitude,
                    COALESCE(r.high, 0) AS high, COALESCE(r.medium, 0) AS medium,
                    COALESCE(r.low, 0) AS low, COALESCE(r.overstocked, 0) AS overstocked,
                    COALESCE(inbound.quantity, 0) AS "pendingInbound",
                    COALESCE(outbound.quantity, 0) AS "pendingOutbound"
                FROM core.dim_warehouse w
                LEFT JOIN risks r ON r.warehouse_id = w.warehouse_id
                LEFT JOIN inbound ON inbound.warehouse_id = w.warehouse_id
                LEFT JOIN outbound ON outbound.warehouse_id = w.warehouse_id
                ORDER BY w.warehouse_id
                """)
                .query((rs, row) -> {
                    Map<String, Object> result = new java.util.LinkedHashMap<>();
                    result.put("warehouseId", rs.getString("warehouseId"));
                    result.put("name", rs.getString("name"));
                    result.put("city", rs.getString("city"));
                    result.put("state", rs.getString("state"));
                    result.put("latitude", rs.getBigDecimal("latitude"));
                    result.put("longitude", rs.getBigDecimal("longitude"));
                    result.put("high", rs.getLong("high"));
                    result.put("medium", rs.getLong("medium"));
                    result.put("low", rs.getLong("low"));
                    result.put("overstocked", rs.getLong("overstocked"));
                    result.put("pendingInbound", rs.getLong("pendingInbound"));
                    result.put("pendingOutbound", rs.getLong("pendingOutbound"));
                    return result;
                })
                .list();
    }

    public PageResponse<Map<String, Object>> risks(
            String level, String warehouseId, String category, String search, int page, int size) {
        validatePage(page, size);
        if (level != null && !level.isBlank() && !RISK_LEVELS.contains(level)) {
            throw ApiException.badRequest("level must be HIGH, MEDIUM or LOW");
        }
        String filter = """
                WHERE (CAST(:level AS text) IS NULL OR a.risk_level = :level)
                  AND (CAST(:warehouseId AS text) IS NULL OR a.warehouse_id = :warehouseId)
                  AND (CAST(:category AS text) IS NULL OR p.category = :category)
                  AND (CAST(:search AS text) IS NULL OR p.sku ILIKE :search OR p.product_name ILIKE :search)
                  AND a.run_id = (SELECT run_id FROM app.optimization_run
                                  WHERE status = 'SUCCEEDED' ORDER BY finished_at DESC LIMIT 1)
                """;
        long total = jdbc.sql("""
                SELECT count(*) FROM app.risk_assessment a
                JOIN core.dim_product p ON p.sku = a.sku
                """ + filter)
                .param("level", blankToNull(level))
                .param("warehouseId", blankToNull(warehouseId))
                .param("category", blankToNull(category))
                .param("search", search == null || search.isBlank() ? null : "%" + search + "%")
                .query(Long.class)
                .single();
        List<Map<String, Object>> items = jdbc.sql("""
                SELECT a.sku, p.product_name AS "productName", p.category AS "categoryCode",
                    a.warehouse_id AS "warehouseId", a.on_hand AS "onHand", a.on_order AS "onOrder",
                    a.mean_daily_demand AS "meanDailyDemand", a.sd_daily_demand AS "sdDailyDemand",
                    a.lead_time_days AS "leadTimeDays", a.days_of_cover AS "daysOfCover",
                    a.projected_stockout_date AS "projectedStockoutDate", a.risk_level AS "riskLevel",
                    a.overstocked, a.safety_stock AS "safetyStock", a.reorder_point AS "reorderPoint"
                FROM app.risk_assessment a
                JOIN core.dim_product p ON p.sku = a.sku
                """ + filter + " ORDER BY CASE a.risk_level WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,"
                        + " a.projected_stockout_date NULLS LAST, a.sku, a.warehouse_id OFFSET :offset LIMIT :size")
                .param("level", blankToNull(level))
                .param("warehouseId", blankToNull(warehouseId))
                .param("category", blankToNull(category))
                .param("search", search == null || search.isBlank() ? null : "%" + search + "%")
                .param("offset", (long) page * size)
                .param("size", size)
                .query((rs, row) -> mapRisk(rs))
                .list();
        return PageResponse.of(items, page, size, total);
    }

    public Map<String, Object> riskDetail(String sku, String warehouseId) {
        Map<String, Object> risk = jdbc.sql("""
                SELECT a.sku, p.product_name AS "productName", p.category AS "categoryCode",
                    a.warehouse_id AS "warehouseId", a.on_hand AS "onHand", a.on_order AS "onOrder",
                    a.mean_daily_demand AS "meanDailyDemand", a.sd_daily_demand AS "sdDailyDemand",
                    a.lead_time_days AS "leadTimeDays", a.days_of_cover AS "daysOfCover",
                    a.projected_stockout_date AS "projectedStockoutDate", a.risk_level AS "riskLevel",
                    a.overstocked, a.safety_stock AS "safetyStock", a.reorder_point AS "reorderPoint"
                FROM app.risk_assessment a JOIN core.dim_product p ON p.sku = a.sku
                WHERE a.sku = :sku AND a.warehouse_id = :warehouseId
                  AND a.run_id = (SELECT run_id FROM app.optimization_run
                                  WHERE status = 'SUCCEEDED' ORDER BY finished_at DESC LIMIT 1)
                """)
                .param("sku", sku)
                .param("warehouseId", warehouseId)
                .query((rs, row) -> mapRisk(rs))
                .optional()
                .orElseThrow(() -> ApiException.notFound("no risk assessment for " + sku + " at " + warehouseId));
        Map<String, Object> product = jdbc.sql("""
                SELECT p.sku, p.product_name AS name, p.category AS "categoryName",
                    NULL::text AS brand, p.unit_cost AS "unitCost", p.unit_price AS "listPrice",
                    NULL::integer AS "shelfLifeDays", p.case_pack AS "casePack",
                    p.supplier_id AS "supplierId", s.supplier_name AS "supplierName",
                    s.region, s.lead_time_mean AS "leadTimeMeanDays", NULL::numeric AS "onTimeRate"
                FROM core.dim_product p JOIN core.dim_supplier s USING (supplier_id)
                WHERE p.sku = :sku
                """)
                .param("sku", sku)
                .query((rs, row) -> {
                    Map<String, Object> result = new java.util.LinkedHashMap<>();
                    result.put("sku", rs.getString("sku"));
                    result.put("name", rs.getString("name"));
                    result.put("categoryName", rs.getString("categoryName"));
                    result.put("brand", rs.getString("brand"));
                    result.put("unitCost", rs.getBigDecimal("unitCost"));
                    result.put("listPrice", rs.getBigDecimal("listPrice"));
                    result.put("shelfLifeDays", rs.getObject("shelfLifeDays"));
                    result.put("casePack", rs.getInt("casePack"));
                    result.put("supplierId", rs.getString("supplierId"));
                    result.put("supplierName", rs.getString("supplierName"));
                    result.put("region", rs.getString("region"));
                    result.put("leadTimeMeanDays", rs.getBigDecimal("leadTimeMeanDays"));
                    result.put("onTimeRate", rs.getBigDecimal("onTimeRate"));
                    return result;
                })
                .single();
        List<Map<String, Object>> openOrders = jdbc.sql("""
                WITH po_dates AS (
                    SELECT po_id, min(event_time)::date AS order_date,
                           min(eta) FILTER (WHERE event_type = 'CREATED') AS promised_date,
                           max(eta) FILTER (WHERE eta IS NOT NULL) AS expected_date
                    FROM core.fact_po_event GROUP BY po_id
                )
                SELECT po.po_id AS "poId", po.quantity AS "orderQty",
                    dates.order_date AS "orderDate", dates.promised_date AS "promisedDate",
                    COALESCE(dates.expected_date, po.eta) AS "expectedDate",
                    COALESCE(dates.expected_date, po.eta) > dates.promised_date AS delayed
                FROM core.v_purchase_order po
                LEFT JOIN po_dates dates ON dates.po_id = po.po_id
                WHERE po.sku = :sku AND po.warehouse_id = :warehouseId AND po.status <> 'RECEIVED'
                ORDER BY COALESCE(dates.expected_date, po.eta)
                """)
                .param("sku", sku)
                .param("warehouseId", warehouseId)
                .query((rs, row) -> Map.<String, Object>of(
                        "poId", rs.getString("poId"),
                        "orderQty", rs.getInt("orderQty"),
                        "orderDate", rs.getObject("orderDate") == null ? "" : rs.getObject("orderDate"),
                        "promisedDate", rs.getObject("promisedDate") == null ? "" : rs.getObject("promisedDate"),
                        "expectedDate", rs.getObject("expectedDate") == null ? "" : rs.getObject("expectedDate"),
                        "delayed", rs.getBoolean("delayed")))
                .list();
        List<Map<String, Object>> otherWarehouses = jdbc.sql("""
                SELECT a.warehouse_id AS "warehouseId", a.on_hand AS "onHand",
                    a.risk_level AS "riskLevel", a.days_of_cover AS "daysOfCover", a.overstocked
                FROM app.risk_assessment a
                WHERE a.sku = :sku AND a.warehouse_id <> :warehouseId
                  AND a.run_id = (SELECT run_id FROM app.optimization_run
                                  WHERE status = 'SUCCEEDED' ORDER BY finished_at DESC LIMIT 1)
                ORDER BY a.warehouse_id
                """)
                .param("sku", sku)
                .param("warehouseId", warehouseId)
                .query((rs, row) -> {
                    Map<String, Object> result = new java.util.LinkedHashMap<>();
                    result.put("warehouseId", rs.getString("warehouseId"));
                    result.put("onHand", rs.getInt("onHand"));
                    result.put("riskLevel", rs.getString("riskLevel"));
                    result.put("daysOfCover", rs.getObject("daysOfCover"));
                    result.put("overstocked", rs.getBoolean("overstocked"));
                    return result;
                })
                .list();
        return Map.of("risk", risk, "product", product, "openOrders", openOrders, "otherWarehouses", otherWarehouses);
    }

    public List<Map<String, Object>> jobs(int limit) {
        if (limit < 1 || limit > 100) {
            throw ApiException.badRequest("limit must be between 1 and 100");
        }
        return jdbc.sql("""
                SELECT kind, id, status, detail, started_at AS "startedAt", finished_at AS "finishedAt"
                FROM (
                    SELECT 'ETL' AS kind, etl_run_id::text AS id, status,
                           COALESCE(source, '') AS detail, started_at, finished_at
                    FROM ops.etl_run
                    UNION ALL
                    SELECT 'FORECAST', run_id::text, status, COALESCE(error, ''), requested_at, finished_at
                    FROM ml.forecast_run
                    UNION ALL
                    SELECT 'OPTIMIZATION', run_id::text, status, COALESCE(result::text, ''), started_at, finished_at
                    FROM app.optimization_run
                ) jobs ORDER BY started_at DESC LIMIT :limit
                """)
                .param("limit", limit)
                .query((rs, row) -> Map.<String, Object>of(
                        "kind", rs.getString("kind"),
                        "id", rs.getString("id"),
                        "status", rs.getString("status"),
                        "detail", rs.getString("detail"),
                        "startedAt", rs.getObject("startedAt"),
                        "finishedAt", rs.getObject("finishedAt") == null ? "" : rs.getObject("finishedAt")))
                .list();
    }

    public Map<String, Object> quality() {
        Map<String, Object> quality = jdbc.sql("""
                SELECT count(*) AS planted, count(*) FILTER (WHERE matched) AS matched
                FROM eval.v_quality_gate_check
                """)
                .query((rs, row) -> Map.<String, Object>of(
                        "plantedDefects", rs.getLong("planted"),
                        "matchedDefects", rs.getLong("matched")))
                .single();
        Map<String, Object> feed = jdbc.sql("""
                SELECT COALESCE(sum(good_count), 0) AS rows_loaded,
                       COALESCE(sum(bad_count), 0) AS rows_quarantined
                FROM ops.etl_file
                """)
                .query((rs, row) -> Map.<String, Object>of(
                        "rowsLoaded", rs.getLong("rows_loaded"),
                        "rowsQuarantined", rs.getLong("rows_quarantined")))
                .single();
        return Map.of("plantedDefects", quality.get("plantedDefects"),
                "matchedDefects", quality.get("matchedDefects"),
                "rowsLoaded", feed.get("rowsLoaded"),
                "rowsQuarantined", feed.get("rowsQuarantined"));
    }

    public PageResponse<Map<String, Object>> orders(String kind, int page, int size) {
        validatePage(page, size);
        if (kind != null && !kind.isBlank() && !List.of("PURCHASE", "TRANSFER").contains(kind)) {
            throw ApiException.badRequest("kind must be PURCHASE or TRANSFER");
        }
        long total = jdbc.sql("SELECT count(*) FROM app.draft_order WHERE (CAST(:kind AS text) IS NULL OR kind = :kind)")
                .param("kind", blankToNull(kind))
                .query(Long.class)
                .single();
        List<Map<String, Object>> items = jdbc.sql("""
                SELECT o.order_id AS "orderId", o.kind, o.recommendation_id AS "recommendationId",
                    o.sku, p.product_name AS "productName", o.warehouse_id AS "warehouseId",
                    o.source_warehouse_id AS "sourceWarehouseId", o.supplier_id AS "supplierId",
                    o.quantity, o.total_value AS "totalValue", o.freight_cost AS "freightCost",
                    o.expected_arrival AS "expectedArrival", o.status, o.created_by AS "createdBy",
                    o.created_at AS "createdAt"
                FROM app.draft_order o JOIN core.dim_product p ON p.sku = o.sku
                WHERE (CAST(:kind AS text) IS NULL OR o.kind = :kind)
                ORDER BY o.created_at DESC OFFSET :offset LIMIT :size
                """)
                .param("kind", blankToNull(kind))
                .param("offset", page * size)
                .param("size", size)
                .query((rs, row) -> {
                    Map<String, Object> item = new java.util.LinkedHashMap<>();
                    for (String column : List.of("orderId", "kind", "recommendationId", "sku", "productName",
                            "warehouseId", "sourceWarehouseId", "supplierId", "quantity", "totalValue",
                            "freightCost", "expectedArrival", "status", "createdBy", "createdAt")) {
                        item.put(column, rs.getObject(column));
                    }
                    return item;
                })
                .list();
        return PageResponse.of(items, page, size, total);
    }

    private Map<String, Object> mapRisk(java.sql.ResultSet rs) throws java.sql.SQLException {
        var result = new java.util.LinkedHashMap<String, Object>();
        for (String column : List.of("sku", "productName", "categoryCode", "warehouseId", "onHand", "onOrder",
                "meanDailyDemand", "sdDailyDemand", "leadTimeDays", "daysOfCover", "projectedStockoutDate",
                "riskLevel", "overstocked", "safetyStock", "reorderPoint")) {
            result.put(column, rs.getObject(column));
        }
        return result;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static void validatePage(int page, int size) {
        if (page < 0 || page > 1_000_000 || size < 1 || size > 500) {
            throw ApiException.badRequest("page must be non-negative and size must be between 1 and 500");
        }
    }
}
