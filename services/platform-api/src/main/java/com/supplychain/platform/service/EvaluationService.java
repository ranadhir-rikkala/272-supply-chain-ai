package com.supplychain.platform.service;

import com.supplychain.platform.api.Actor;
import com.supplychain.platform.risk.RiskEngine;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EvaluationService {
    private final JdbcClient jdbc;
    private final JdbcTemplate jdbcTemplate;
    private final SettingService settings;
    private final AuditService audit;
    public EvaluationService(
            JdbcClient jdbc,
            JdbcTemplate jdbcTemplate,
            SettingService settings,
            AuditService audit) {
        this.jdbc = jdbc;
        this.jdbcTemplate = jdbcTemplate;
        this.settings = settings;
        this.audit = audit;
    }

    public Map<String, Object> latest() {
        List<Map<String, Object>> rows = jdbc.sql("""
                SELECT disruption_id AS "disruptionId", kind, start_date AS "startDate",
                    end_date AS "endDate", description, impacted_cells AS "impactedCells",
                    flagged_seven_days_ahead AS "flaggedSevenDaysAhead", median_lead_days AS "medianLeadDays",
                    caught, without_stockouts AS "withoutStockouts"
                FROM eval.risk_flag_result
                WHERE evaluation_id = (SELECT evaluation_id FROM eval.risk_flag_result
                                       ORDER BY evaluated_at DESC LIMIT 1)
                ORDER BY start_date, disruption_id
                """)
                .query((rs, row) -> disruptionResult(
                        rs.getString("disruptionId"),
                        rs.getString("kind"),
                        rs.getObject("startDate", LocalDate.class),
                        rs.getObject("endDate", LocalDate.class),
                        rs.getString("description"),
                        rs.getInt("impactedCells"),
                        rs.getInt("flaggedSevenDaysAhead"),
                        rs.getObject("medianLeadDays") == null ? null : rs.getDouble("medianLeadDays"),
                        rs.getBoolean("caught"),
                        rs.getInt("withoutStockouts")))
                .list();
        return summarize(rows);
    }

    @Transactional
    public Map<String, Object> run() {
        List<Disruption> disruptions = jdbc.sql("""
                SELECT disruption_id, disruption_type AS kind, start_date, end_date, description,
                    supplier_id, sku, warehouse_id
                FROM eval.disruption_truth ORDER BY start_date, disruption_id
                """)
                .query((rs, row) -> new Disruption(
                        rs.getString("disruption_id"),
                        rs.getString("kind"),
                        rs.getObject("start_date", LocalDate.class),
                        rs.getObject("end_date", LocalDate.class),
                        rs.getString("description"),
                        rs.getString("supplier_id"),
                        rs.getString("sku"),
                        rs.getString("warehouse_id")))
                .list();
        UUID evaluationId = UUID.randomUUID();
        int safetyDays = settings.list().stream()
                .filter(row -> "safety_days".equals(row.get("key")))
                .findFirst()
                .map(row -> ((Number) row.get("value")).intValue())
                .orElse(7);
        List<EvaluatedDisruption> evaluated = new ArrayList<>();
        for (Disruption disruption : disruptions) {
            evaluated.add(evaluate(disruption, safetyDays));
        }
        jdbcTemplate.batchUpdate("""
                INSERT INTO eval.risk_flag_result
                    (evaluation_id, disruption_id, kind, start_date, end_date, description,
                     impacted_cells, flagged_seven_days_ahead, without_stockouts, median_lead_days, caught)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, evaluated, 100, (statement, item) -> {
            statement.setObject(1, evaluationId);
            statement.setString(2, item.disruption().id());
            statement.setString(3, item.disruption().kind());
            statement.setObject(4, item.disruption().startDate());
            statement.setObject(5, item.disruption().endDate());
            statement.setString(6, item.disruption().description());
            statement.setInt(7, item.impactedCells());
            statement.setInt(8, item.flagged());
            statement.setInt(9, item.withoutStockouts());
            if (item.medianLeadDays() == null) {
                statement.setNull(10, java.sql.Types.DOUBLE);
            } else {
                statement.setDouble(10, item.medianLeadDays());
            }
            statement.setBoolean(11, item.flagged() > 0);
        });
        List<Map<String, Object>> rows = evaluated.stream()
                .map(item -> disruptionResult(
                        item.disruption().id(),
                        item.disruption().kind(),
                        item.disruption().startDate(),
                        item.disruption().endDate(),
                        item.disruption().description(),
                        item.impactedCells(),
                        item.flagged(),
                        item.medianLeadDays(),
                        item.flagged() > 0,
                        item.withoutStockouts()))
                .toList();
        Map<String, Object> summary = summarize(rows);
        audit.record("RISK_EVALUATION_RUN", "evaluation", evaluationId.toString(), null, summary);
        return summary;
    }

    private EvaluatedDisruption evaluate(Disruption disruption, int safetyDays) {
        List<ImpactedCell> cells = jdbc.sql("""
                SELECT DISTINCT p.sku, i.warehouse_id,
                    (SELECT min(stock.feed_date) FROM core.fact_inventory_daily stock
                     WHERE stock.sku = p.sku AND stock.warehouse_id = i.warehouse_id
                       AND stock.feed_date >= :startDate AND stock.feed_date <= :endDate
                       AND stock.stockout_flag) AS first_stockout
                FROM core.dim_product p
                JOIN core.dim_supplier supplier ON supplier.supplier_id = p.supplier_id
                JOIN core.fact_inventory_daily i ON i.sku = p.sku
                WHERE (CAST(:kind AS text) = 'SUPPLIER_DELAY' AND p.supplier_id = :supplierId)
                   OR (CAST(:kind AS text) = 'PORT_CLOSURE' AND supplier.region = 'CHINA'
                       AND i.warehouse_id = :warehouseId)
                   OR (CAST(:kind AS text) = 'HEAT_WAVE' AND i.warehouse_id = :warehouseId
                       AND p.category IN ('BEV', 'FRZ', 'OUT'))
                   OR (CAST(:kind AS text) = 'COLD_SNAP' AND i.warehouse_id = :warehouseId
                       AND p.category IN ('WIN', 'PHA'))
                   OR (CAST(:kind AS text) = 'PANIC_BUYING' AND i.warehouse_id = :warehouseId
                       AND p.category IN ('PAP', 'PCR', 'PHA', 'DAI'))
                   OR (CAST(:kind AS text) = 'VIRAL_PRODUCT' AND p.sku = :sku)
                """)
                .param("kind", disruption.kind())
                .param("sku", disruption.sku())
                .param("supplierId", disruption.supplierId())
                .param("warehouseId", disruption.warehouseId())
                .param("startDate", disruption.startDate())
                .param("endDate", disruption.endDate())
                .query((rs, row) -> new ImpactedCell(
                        rs.getString("sku"),
                        rs.getString("warehouse_id"),
                        rs.getObject("first_stockout", LocalDate.class)))
                .list();
        int flagged = 0;
        int withoutStockout = 0;
        List<Long> warningDays = new ArrayList<>();
        for (ImpactedCell cell : cells) {
            if (cell.firstStockout() == null) {
                withoutStockout++;
                continue;
            }
            LocalDate lastDetectionDate = cell.firstStockout().minusDays(7);
            LocalDate firstDetection = null;
            for (LocalDate day = disruption.startDate();
                    !day.isAfter(lastDetectionDate);
                    day = day.plusDays(1)) {
                RiskEngine.Assessment assessment = assessAt(cell.sku(), cell.warehouseId(), day, safetyDays);
                if (warnsBefore(assessment, cell.firstStockout())) {
                    firstDetection = day;
                    break;
                }
            }
            if (firstDetection != null) {
                flagged++;
                warningDays.add(ChronoUnit.DAYS.between(firstDetection, cell.firstStockout()));
            }
        }
        Double medianLeadDays = null;
        if (!warningDays.isEmpty()) {
            warningDays.sort(Comparator.naturalOrder());
            int middle = warningDays.size() / 2;
            medianLeadDays = warningDays.size() % 2 == 0
                    ? (warningDays.get(middle - 1) + warningDays.get(middle)) / 2.0
                    : warningDays.get(middle).doubleValue();
        }
        return new EvaluatedDisruption(disruption, cells.size(), flagged, medianLeadDays, withoutStockout);
    }

    /**
     * A cell counts as warned when the engine raises its risk and projects a stockout no later
     * than the one that actually happened. The caller only asks about days at least seven days
     * before the actual stockout, so a true result means the warning came seven or more days ahead.
     */
    static boolean warnsBefore(RiskEngine.Assessment assessment, LocalDate actualStockout) {
        return !"LOW".equals(assessment.riskLevel())
                && assessment.projectedStockoutDate() != null
                && !assessment.projectedStockoutDate().isAfter(actualStockout);
    }

    private RiskEngine.Assessment assessAt(String sku, String warehouseId, LocalDate day, int safetyDays) {
        var current = jdbc.sql("""
                SELECT i.on_hand, COALESCE(s.lead_time_mean, 7) AS lead_time,
                    COALESCE(s.lead_time_sd, 0) AS lead_sd, p.case_pack
                FROM core.fact_inventory_daily i
                JOIN core.dim_product p ON p.sku = i.sku
                JOIN core.dim_supplier s ON s.supplier_id = p.supplier_id
                WHERE i.sku = :sku AND i.warehouse_id = :warehouseId AND i.feed_date <= :day
                ORDER BY i.feed_date DESC LIMIT 1
                """)
                .param("sku", sku)
                .param("warehouseId", warehouseId)
                .param("day", day)
                .query((rs, row) -> new CurrentCell(
                        rs.getInt("on_hand"),
                        rs.getDouble("lead_time"),
                        rs.getDouble("lead_sd"),
                        rs.getInt("case_pack")))
                .optional()
                .orElse(null);
        if (current == null) {
            return new RiskEngine.Assessment("LOW", 0, 0, 0, null, null, false);
        }
        double[] stats = jdbc.sql("""
                SELECT COALESCE(avg(units_sold), 0)::double precision AS mean,
                    COALESCE(stddev_samp(units_sold), 0)::double precision AS deviation
                FROM core.fact_sales_daily
                WHERE sku = :sku AND warehouse_id = :warehouseId
                  AND feed_date > :day - 28 AND feed_date <= :day
                """)
                .param("sku", sku)
                .param("warehouseId", warehouseId)
                .param("day", day)
                .query((rs, row) -> new double[] {rs.getDouble("mean"), rs.getDouble("deviation")})
                .single();
        List<RiskEngine.Arrival> arrivals = jdbc.sql("""
                WITH cell_orders AS (
                    SELECT DISTINCT po_id
                    FROM core.fact_po_event
                    WHERE sku = :sku AND warehouse_id = :warehouseId AND event_time::date <= :day
                ),
                known_events AS (
                    SELECT DISTINCT ON (e.po_id) e.po_id, e.event_type, e.eta, e.quantity
                    FROM core.fact_po_event e
                    JOIN cell_orders c ON c.po_id = e.po_id
                    WHERE e.event_time::date <= :day AND e.event_type IN ('CREATED', 'ETA_UPDATED', 'CANCELLED')
                    ORDER BY e.po_id, (e.event_type = 'ETA_UPDATED') DESC, e.event_time DESC, e.event_id DESC
                )
                SELECT e.eta, e.quantity
                FROM known_events e
                WHERE e.event_type <> 'CANCELLED' AND e.eta IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM core.fact_receipt r
                    WHERE r.po_id = e.po_id AND r.receipt_date <= :day)
                """)
                .param("day", day)
                .param("sku", sku)
                .param("warehouseId", warehouseId)
                .query((rs, row) -> new RiskEngine.Arrival(
                        rs.getObject("eta", LocalDate.class),
                        rs.getInt("quantity")))
                .list();
        return RiskEngine.assess(new RiskEngine.Input(
                day,
                current.onHand(),
                arrivals,
                Collections.nCopies(28, stats[0]),
                stats[0],
                stats[1],
                current.leadTime(),
                current.leadTimeSd(),
                current.casePack(),
                null,
                safetyDays,
                90,
                1.65,
                7));
    }

    private Map<String, Object> summarize(List<Map<String, Object>> rows) {
        int evaluated = rows.size();
        int caught = (int) rows.stream().filter(row -> Boolean.TRUE.equals(row.get("caught"))).count();
        int impacted = rows.stream().mapToInt(row -> ((Number) row.get("impactedCells")).intValue()).sum();
        int flagged = rows.stream().mapToInt(row -> ((Number) row.get("flaggedSevenDaysAhead")).intValue()).sum();
        int withoutStockouts = rows.stream()
                .mapToInt(row -> ((Number) row.get("withoutStockouts")).intValue())
                .sum();
        double share = impacted == 0 ? 0 : flagged / (double) impacted;
        return Map.of(
                "evaluated", evaluated,
                "caught", caught,
                "withoutStockouts", withoutStockouts,
                "impactedCells", impacted,
                "flaggedCells", flagged,
                "cellShare", share,
                "disruptions", rows);
    }

    private Map<String, Object> disruptionResult(
            String id,
            String kind,
            LocalDate start,
            LocalDate end,
            String description,
            int impacted,
            int flagged,
            Double medianLeadDays,
            boolean caught,
            int withoutStockouts) {
        var result = new java.util.LinkedHashMap<String, Object>();
        result.put("disruptionId", id);
        result.put("kind", kind);
        result.put("startDate", start.toString());
        result.put("endDate", end.toString());
        result.put("description", description);
        result.put("impactedCells", impacted);
        result.put("flaggedSevenDaysAhead", flagged);
        result.put("share", impacted == 0 ? 0 : flagged / (double) impacted);
        result.put("medianLeadDays", medianLeadDays);
        result.put("caught", caught);
        result.put("withoutStockouts", withoutStockouts);
        return result;
    }

    private record Disruption(
            String id,
            String kind,
            LocalDate startDate,
            LocalDate endDate,
            String description,
            String supplierId,
            String sku,
            String warehouseId) {}
    private record ImpactedCell(String sku, String warehouseId, LocalDate firstStockout) {}
    private record CurrentCell(int onHand, double leadTime, double leadTimeSd, int casePack) {}
    private record EvaluatedDisruption(
            Disruption disruption,
            int impactedCells,
            int flagged,
            Double medianLeadDays,
            int withoutStockouts) {}
}
