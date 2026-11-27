package com.supplychain.platform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.supplychain.platform.alerts.RiskAlert;
import com.supplychain.platform.alerts.RiskAlertsRaised;
import com.supplychain.platform.api.Actor;
import com.supplychain.platform.api.ApiException;
import com.supplychain.platform.risk.RiskEngine;
import com.supplychain.platform.risk.TransferPlanner;
import java.sql.Array;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OptimizationService {
    private final JdbcClient jdbc;
    private final JdbcTemplate jdbcTemplate;
    private final AuditService audit;
    private final ObjectMapper objectMapper;
    private final ApplicationEventPublisher events;

    public OptimizationService(
            JdbcClient jdbc,
            JdbcTemplate jdbcTemplate,
            AuditService audit,
            ObjectMapper objectMapper,
            ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.jdbcTemplate = jdbcTemplate;
        this.audit = audit;
        this.objectMapper = objectMapper;
        this.events = events;
    }

    @Transactional
    public Map<String, Object> run() {
        ForecastRun forecast = latestForecast();
        List<Cell> cells = loadCells();
        if (cells.isEmpty()) {
            throw ApiException.conflict("no inventory and demand cells are available for optimization");
        }
        LocalDate asOfDate = cells.stream().map(Cell::asOfDate).max(LocalDate::compareTo).orElseThrow();
        double safetyDays = setting("safety_days", 7);
        int overstockDays = (int) setting("overstock_days", 90);
        double freightRate = setting("freight_cost_per_mile", 1.25);
        Map<CellKey, EvaluatedCell> evaluated = new LinkedHashMap<>();
        long high = 0;
        long medium = 0;
        long overstocked = 0;
        for (Cell cell : cells) {
            RiskEngine.Assessment assessment = RiskEngine.assess(new RiskEngine.Input(
                    cell.asOfDate(),
                    cell.onHand(),
                    cell.arrivals(),
                    cell.forecastDemand(),
                    cell.meanDailyDemand(),
                    cell.sdDailyDemand(),
                    cell.leadTimeDays(),
                    cell.leadTimeSdDays(),
                    cell.casePack(),
                    cell.shelfLifeDays(),
                    (int) safetyDays,
                    overstockDays,
                    1.65,
                    7));
            EvaluatedCell result = new EvaluatedCell(cell, assessment);
            evaluated.put(new CellKey(cell.sku(), cell.warehouseId()), result);
            if ("HIGH".equals(assessment.riskLevel())) {
                high++;
            } else if ("MEDIUM".equals(assessment.riskLevel())) {
                medium++;
            }
            if (assessment.overstocked()) {
                overstocked++;
            }
        }

        UUID runId = UUID.randomUUID();
        String actor = Actor.current().username();
        jdbc.sql("""
                INSERT INTO app.optimization_run (run_id, as_of_date, model_version, status, requested_by)
                VALUES (:runId, :asOfDate, :modelVersion, 'SUCCEEDED', :actor)
                """)
                .param("runId", runId)
                .param("asOfDate", asOfDate)
                .param("modelVersion", forecast.modelVersion())
                .param("actor", actor)
                .update();

        jdbcTemplate.batchUpdate("""
                INSERT INTO app.risk_assessment
                    (run_id, sku, warehouse_id, as_of_date, on_hand, on_order, mean_daily_demand,
                     sd_daily_demand, lead_time_days, days_of_cover, projected_stockout_date,
                     risk_level, overstocked, safety_stock, reorder_point)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, evaluated.values(), 500, (statement, value) -> {
            Cell cell = value.cell();
            RiskEngine.Assessment assessment = value.assessment();
            statement.setObject(1, runId);
            statement.setString(2, cell.sku());
            statement.setString(3, cell.warehouseId());
            statement.setObject(4, cell.asOfDate());
            statement.setInt(5, cell.onHand());
            statement.setInt(6, cell.onOrder());
            statement.setDouble(7, cell.meanDailyDemand());
            statement.setDouble(8, cell.sdDailyDemand());
            statement.setDouble(9, cell.leadTimeDays());
            if (assessment.daysOfCover() == null) {
                statement.setNull(10, java.sql.Types.DOUBLE);
            } else {
                statement.setDouble(10, assessment.daysOfCover());
            }
            statement.setObject(11, assessment.projectedStockoutDate());
            statement.setString(12, assessment.riskLevel());
            statement.setBoolean(13, assessment.overstocked());
            statement.setInt(14, assessment.safetyStock());
            statement.setInt(15, assessment.reorderPoint());
        });

        int superseded = supersedePendingRecommendations();
        List<NewRecommendation> recommendations = buildRecommendations(runId, evaluated, freightRate, asOfDate);
        insertRecommendations(recommendations);
        long reorders = recommendations.stream().filter(value -> "REORDER".equals(value.kind())).count();
        long transfers = recommendations.stream().filter(value -> "TRANSFER".equals(value.kind())).count();
        Map<String, Object> summary = Map.of(
                "runId", runId,
                "asOfDate", asOfDate.toString(),
                "modelVersion", forecast.modelVersion(),
                "cells", cells.size(),
                "high", high,
                "medium", medium,
                "overstocked", overstocked,
                "reorders", reorders,
                "transfers", transfers,
                "superseded", superseded);
        jdbc.sql("UPDATE app.optimization_run SET result = CAST(:result AS jsonb) WHERE run_id = :runId")
                .param("result", writeJson(summary))
                .param("runId", runId)
                .update();
        audit.record("OPTIMIZATION_RUN", "optimization_run", runId.toString(), null, summary);
        events.publishEvent(new RiskAlertsRaised(runId, asOfDate, forecast.modelVersion(), actor, highRiskAlerts(evaluated)));
        return summary;
    }

    private static List<RiskAlert> highRiskAlerts(Map<CellKey, EvaluatedCell> evaluated) {
        return evaluated.values().stream()
                .filter(value -> "HIGH".equals(value.assessment().riskLevel()))
                .map(value -> new RiskAlert(
                        value.cell().sku(),
                        value.cell().warehouseId(),
                        value.cell().productName(),
                        value.cell().category(),
                        value.cell().onHand(),
                        value.cell().onOrder(),
                        value.assessment().daysOfCover(),
                        value.assessment().projectedStockoutDate(),
                        value.assessment().recommendedQuantity()))
                .toList();
    }

    private ForecastRun latestForecast() {
        return jdbc.sql("""
                SELECT run_id, model_version FROM ml.forecast_run
                WHERE status = 'SUCCEEDED'
                ORDER BY finished_at DESC NULLS LAST, requested_at DESC
                LIMIT 1
                """)
                .query((rs, row) -> new ForecastRun(rs.getObject("run_id", UUID.class), rs.getString("model_version")))
                .optional()
                .orElseThrow(() -> ApiException.conflict("a SUCCEEDED forecast run is required before optimization"));
    }

    private List<Cell> loadCells() {
        List<Cell> cells = jdbc.sql("""
                WITH latest_inventory AS (
                    SELECT latest.feed_date, p.sku, w.warehouse_id, latest.on_hand, latest.on_order
                    FROM core.dim_product p
                    CROSS JOIN core.dim_warehouse w
                    CROSS JOIN LATERAL (
                        SELECT i.feed_date, i.on_hand, i.on_order
                        FROM core.fact_inventory_daily i
                        WHERE i.sku = p.sku AND i.warehouse_id = w.warehouse_id
                        ORDER BY i.feed_date DESC
                        LIMIT 1
                    ) latest
                ),
                last_date AS (
                    SELECT max(feed_date) AS as_of_date FROM latest_inventory
                ),
                demand AS (
                    SELECT s.sku, s.warehouse_id,
                        avg(s.units_sold)::double precision AS mean_demand,
                        COALESCE(stddev_samp(s.units_sold), 0)::double precision AS sd_demand
                    FROM core.fact_sales_daily s CROSS JOIN last_date d
                    WHERE s.feed_date > d.as_of_date - 90 AND s.feed_date <= d.as_of_date
                    GROUP BY s.sku, s.warehouse_id
                ),
                forecast AS (
                    SELECT sku, warehouse_id, model_version,
                        array_agg(yhat ORDER BY target_date) AS forecast_values
                    FROM ml.v_current_forecast
                    GROUP BY sku, warehouse_id, model_version
                ),
                open_orders AS (
                    SELECT sku, warehouse_id,
                        array_agg(concat(COALESCE(eta, current_date), '|', quantity)::text) AS order_values
                    FROM core.v_purchase_order
                    WHERE status <> 'RECEIVED'
                    GROUP BY sku, warehouse_id
                )
                SELECT i.feed_date AS as_of_date, i.sku, i.warehouse_id, i.on_hand, i.on_order,
                    COALESCE(d.mean_demand, 0)::double precision AS mean_demand,
                    COALESCE(d.sd_demand, 0)::double precision AS sd_demand,
                    COALESCE(s.lead_time_mean, 7)::double precision AS lead_time,
                    COALESCE(s.lead_time_sd, 0)::double precision AS lead_time_sd,
                    p.case_pack, p.unit_cost, p.supplier_id, p.product_name, p.category,
                    w.latitude, w.longitude,
                    COALESCE(f.forecast_values, ARRAY[]::double precision[]) AS forecast_values,
                    COALESCE(o.order_values, ARRAY[]::text[]) AS order_values,
                    NULL::integer AS shelf_life_days
                FROM latest_inventory i
                JOIN core.dim_product p ON p.sku = i.sku
                JOIN core.dim_supplier s ON s.supplier_id = p.supplier_id
                JOIN core.dim_warehouse w ON w.warehouse_id = i.warehouse_id
                LEFT JOIN demand d ON d.sku = i.sku AND d.warehouse_id = i.warehouse_id
                LEFT JOIN forecast f ON f.sku = i.sku AND f.warehouse_id = i.warehouse_id
                LEFT JOIN open_orders o ON o.sku = i.sku AND o.warehouse_id = i.warehouse_id
                ORDER BY i.sku, i.warehouse_id
                """)
                .query((rs, row) -> {
                    LocalDate asOfDate = rs.getObject("as_of_date", LocalDate.class);
                    return new Cell(
                            asOfDate,
                            rs.getString("sku"),
                            rs.getString("warehouse_id"),
                            rs.getInt("on_hand"),
                            rs.getInt("on_order"),
                            rs.getDouble("mean_demand"),
                            rs.getDouble("sd_demand"),
                            rs.getDouble("lead_time"),
                            rs.getDouble("lead_time_sd"),
                            rs.getInt("case_pack"),
                            rs.getObject("shelf_life_days", Integer.class),
                            rs.getBigDecimal("unit_cost"),
                            rs.getString("supplier_id"),
                            rs.getString("product_name"),
                            rs.getString("category"),
                            rs.getDouble("latitude"),
                            rs.getDouble("longitude"),
                            doubleArray(rs.getArray("forecast_values")),
                            parseArrivals(rs.getArray("order_values"), asOfDate));
                })
                .list();
        return cells;
    }

    private List<NewRecommendation> buildRecommendations(
            UUID runId, Map<CellKey, EvaluatedCell> cells, double freightRate, LocalDate asOfDate) {
        List<NewRecommendation> result = new ArrayList<>();
        Map<String, List<EvaluatedCell>> bySku = cells.values().stream()
                .collect(java.util.stream.Collectors.groupingBy(value -> value.cell().sku()));
        for (EvaluatedCell target : cells.values()) {
            RiskEngine.Assessment assessment = target.assessment();
            if (assessment.recommendedQuantity() <= 0
                    || !List.of("HIGH", "MEDIUM").contains(assessment.riskLevel())) {
                continue;
            }
            Cell cell = target.cell();
            List<TransferPlanner.WarehouseSurplus> surplus = bySku.getOrDefault(cell.sku(), List.of()).stream()
                    .filter(other -> !other.cell().warehouseId().equals(cell.warehouseId()))
                    .map(other -> new TransferPlanner.WarehouseSurplus(
                            other.cell().warehouseId(),
                            other.cell().latitude(),
                            other.cell().longitude(),
                            Math.max(0, other.cell().onHand() + other.cell().onOrder()
                                    - other.assessment().reorderPoint())))
                    .filter(other -> other.surplus() > 0)
                    .toList();
            List<TransferPlanner.Transfer> transfers = TransferPlanner.plan(
                    cell.warehouseId(),
                    cell.latitude(),
                    cell.longitude(),
                    assessment.recommendedQuantity(),
                    cell.leadTimeDays(),
                    freightRate,
                    surplus);
            int transferred = 0;
            for (TransferPlanner.Transfer transfer : transfers) {
                transferred += transfer.quantity();
                result.add(new NewRecommendation(
                        UUID.randomUUID(),
                        runId,
                        "TRANSFER",
                        cell.sku(),
                        cell.warehouseId(),
                        transfer.sourceWarehouseId(),
                        null,
                        transfer.quantity(),
                        cell.unitCost(),
                        transfer.freightCost(),
                        transfer.distanceMiles(),
                        transfer.transitDays(),
                        asOfDate.plusDays(transfer.transitDays()),
                        assessment.riskLevel(),
                        "Transfer surplus stock to cover " + assessment.riskLevel().toLowerCase() + " risk"));
            }
            int reorderQuantity = Math.max(0, assessment.recommendedQuantity() - transferred);
            if (reorderQuantity > 0) {
                result.add(new NewRecommendation(
                        UUID.randomUUID(),
                        runId,
                        "REORDER",
                        cell.sku(),
                        cell.warehouseId(),
                        null,
                        cell.supplierId(),
                        reorderQuantity,
                        cell.unitCost(),
                        0,
                        0,
                        (int) Math.ceil(cell.leadTimeDays()),
                        asOfDate.plusDays((long) Math.ceil(cell.leadTimeDays())),
                        assessment.riskLevel(),
                        "Reorder to cover " + assessment.riskLevel().toLowerCase() + " risk"));
            }
        }
        return result;
    }

    private int supersedePendingRecommendations() {
        List<SupersededRecommendation> rows = jdbc.sql("""
                WITH existing AS (
                    SELECT recommendation_id, status FROM app.recommendation
                    WHERE status IN ('PENDING_REVIEW', 'PENDING_MANAGER')
                    FOR UPDATE
                ),
                updated AS (
                    UPDATE app.recommendation r
                    SET status = 'SUPERSEDED', version = version + 1, updated_at = now()
                    FROM existing e WHERE r.recommendation_id = e.recommendation_id
                    RETURNING r.recommendation_id
                )
                SELECT e.recommendation_id, e.status
                FROM existing e JOIN updated u USING (recommendation_id)
                """)
                .query((rs, row) -> new SupersededRecommendation(
                        rs.getObject("recommendation_id", UUID.class), rs.getString("status")))
                .list();
        if (rows.isEmpty()) {
            return 0;
        }
        Actor actor = Actor.current();
        jdbcTemplate.batchUpdate("""
                INSERT INTO app.recommendation_event
                    (recommendation_id, from_status, to_status, actor, actor_roles, comment)
                VALUES (?, ?, 'SUPERSEDED', ?, CAST(? AS jsonb), 'Superseded by a new optimization run')
                """, rows, 500, (statement, recommendation) -> {
            statement.setObject(1, recommendation.id());
            statement.setString(2, recommendation.status());
            statement.setString(3, actor.username());
            statement.setString(4, writeJson(actor.roles()));
        });
        for (SupersededRecommendation recommendation : rows) {
            audit.record("RECOMMENDATION_SUPERSEDED", "recommendation", recommendation.id().toString(),
                    Map.of("status", recommendation.status()), Map.of("status", "SUPERSEDED"));
        }
        return rows.size();
    }

    private void insertRecommendations(List<NewRecommendation> recommendations) {
        Actor actor = Actor.current();
        jdbcTemplate.batchUpdate("""
                INSERT INTO app.recommendation
                    (recommendation_id, run_id, kind, sku, warehouse_id, source_warehouse_id, supplier_id,
                     quantity, unit_cost, freight_cost, distance_miles, lead_days, expected_arrival,
                     risk_level, reason, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW')
                """, recommendations, 500, (statement, value) -> {
            statement.setObject(1, value.id());
            statement.setObject(2, value.runId());
            statement.setString(3, value.kind());
            statement.setString(4, value.sku());
            statement.setString(5, value.warehouseId());
            statement.setString(6, value.sourceWarehouseId());
            statement.setString(7, value.supplierId());
            statement.setInt(8, value.quantity());
            statement.setBigDecimal(9, value.unitCost());
            statement.setBigDecimal(10, java.math.BigDecimal.valueOf(value.freightCost()));
            statement.setBigDecimal(11, java.math.BigDecimal.valueOf(value.distanceMiles()));
            statement.setInt(12, value.leadDays());
            statement.setObject(13, value.expectedArrival());
            statement.setString(14, value.riskLevel());
            statement.setString(15, value.reason());
        });
    }

    private double setting(String key, double fallback) {
        return jdbc.sql("SELECT value FROM app.setting WHERE key = :key")
                .param("key", key)
                .query(Double.class)
                .optional()
                .orElse(fallback);
    }

    private List<Double> doubleArray(Array array) throws SQLException {
        if (array == null) {
            return List.of();
        }
        Object raw = array.getArray();
        if (!(raw instanceof Object[] values)) {
            return List.of();
        }
        List<Double> result = new ArrayList<>(values.length);
        for (Object value : values) {
            if (value instanceof Number number) {
                result.add(number.doubleValue());
            }
        }
        return result;
    }

    private List<RiskEngine.Arrival> parseArrivals(Array array, LocalDate asOfDate) throws SQLException {
        if (array == null || !(array.getArray() instanceof Object[] values)) {
            return List.of();
        }
        List<RiskEngine.Arrival> result = new ArrayList<>(values.length);
        for (Object value : values) {
            String[] parts = String.valueOf(value).split("\\|", 2);
            if (parts.length == 2) {
                result.add(new RiskEngine.Arrival(LocalDate.parse(parts[0]), Integer.parseInt(parts[1])));
            }
        }
        return result;
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalStateException("optimization result could not be serialized", exception);
        }
    }

    private record ForecastRun(UUID runId, String modelVersion) {}
    private record SupersededRecommendation(UUID id, String status) {}
    private record CellKey(String sku, String warehouseId) {}
    private record EvaluatedCell(Cell cell, RiskEngine.Assessment assessment) {}
    private record Cell(
            LocalDate asOfDate,
            String sku,
            String warehouseId,
            int onHand,
            int onOrder,
            double meanDailyDemand,
            double sdDailyDemand,
            double leadTimeDays,
            double leadTimeSdDays,
            int casePack,
            Integer shelfLifeDays,
            java.math.BigDecimal unitCost,
            String supplierId,
            String productName,
            String category,
            double latitude,
            double longitude,
            List<Double> forecastDemand,
            List<RiskEngine.Arrival> arrivals) {
    }
    private record NewRecommendation(
            UUID id,
            UUID runId,
            String kind,
            String sku,
            String warehouseId,
            String sourceWarehouseId,
            String supplierId,
            int quantity,
            java.math.BigDecimal unitCost,
            double freightCost,
            double distanceMiles,
            int leadDays,
            LocalDate expectedArrival,
            String riskLevel,
            String reason) {}
}
