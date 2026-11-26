package com.supplychain.platform.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.supplychain.platform.api.Actor;
import com.supplychain.platform.api.ApiException;
import com.supplychain.platform.api.PageResponse;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RecommendationService {
    private static final List<String> STATUSES = List.of(
            "PENDING_REVIEW", "PENDING_MANAGER", "APPROVED", "REJECTED", "SUPERSEDED");
    private final JdbcClient jdbc;
    private final SettingService settings;
    private final AuditService audit;
    private final ObjectMapper objectMapper;

    public RecommendationService(
            JdbcClient jdbc, SettingService settings, AuditService audit, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.audit = audit;
        this.objectMapper = objectMapper;
    }

    public PageResponse<Map<String, Object>> list(
            String status, String kind, String warehouseId, int page, int size) {
        validatePage(page, size);
        List<String> statuses = parseStatuses(status);
        if (kind != null && !kind.isBlank() && !List.of("REORDER", "TRANSFER").contains(kind)) {
            throw ApiException.badRequest("kind must be REORDER or TRANSFER");
        }
        String filter = """
                WHERE status IN (:statuses)
                  AND (CAST(:kind AS text) IS NULL OR kind = :kind)
                  AND (CAST(:warehouseId AS text) IS NULL OR warehouse_id = :warehouseId OR source_warehouse_id = :warehouseId)
                """;
        long total = jdbc.sql("SELECT count(*) FROM app.recommendation " + filter)
                .param("statuses", statuses)
                .param("kind", blankToNull(kind))
                .param("warehouseId", blankToNull(warehouseId))
                .query(Long.class)
                .single();
        List<Map<String, Object>> items = jdbc.sql("""
                SELECT r.recommendation_id AS "recommendationId", r.kind, r.sku,
                    p.product_name AS "productName", r.warehouse_id AS "warehouseId",
                    r.source_warehouse_id AS "sourceWarehouseId", r.supplier_id AS "supplierId",
                    r.quantity, r.unit_cost AS "unitCost",
                    (r.quantity * r.unit_cost + COALESCE(r.freight_cost, 0)) AS "totalValue",
                    r.freight_cost AS "freightCost", r.distance_miles AS "distanceMiles",
                    r.lead_days AS "leadDays", r.expected_arrival AS "expectedArrival",
                    r.risk_level AS "riskLevel", r.reason, r.status, r.endorsed_by AS "endorsedBy",
                    r.decided_by AS "decidedBy", r.version
                FROM app.recommendation r JOIN core.dim_product p ON p.sku = r.sku
                """ + filter
                        + " ORDER BY CASE r.risk_level WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,"
                        + " (r.quantity * r.unit_cost + COALESCE(r.freight_cost, 0)) DESC,"
                        + " r.created_at OFFSET :offset LIMIT :size")
                .param("statuses", statuses)
                .param("kind", blankToNull(kind))
                .param("warehouseId", blankToNull(warehouseId))
                .param("offset", (long) page * size)
                .param("size", size)
                .query((rs, row) -> recommendationRow(rs))
                .list();
        return PageResponse.of(items, page, size, total);
    }

    public Map<String, Object> detail(UUID recommendationId) {
        Map<String, Object> recommendation = find(recommendationId, false);
        List<Map<String, Object>> events = jdbc.sql("""
                SELECT event_id AS "eventId", from_status AS "fromStatus", to_status AS "toStatus",
                    actor, actor_roles AS "actorRoles", comment,
                    quantity_before AS "quantityBefore", quantity_after AS "quantityAfter",
                    created_at AS "createdAt"
                FROM app.recommendation_event WHERE recommendation_id = :id ORDER BY event_id
                """)
                .param("id", recommendationId)
                .query((rs, row) -> {
                    Map<String, Object> event = new java.util.LinkedHashMap<>();
                    event.put("eventId", rs.getLong("eventId"));
                    event.put("fromStatus", rs.getString("fromStatus"));
                    event.put("toStatus", rs.getString("toStatus"));
                    event.put("actor", rs.getString("actor"));
                    event.put("actorRoles", parseJsonRoles(rs.getString("actorRoles")));
                    event.put("comment", rs.getString("comment"));
                    event.put("quantityBefore", rs.getObject("quantityBefore"));
                    event.put("quantityAfter", rs.getObject("quantityAfter"));
                    event.put("createdAt", rs.getObject("createdAt"));
                    return event;
                })
                .list();
        return Map.of("recommendation", recommendation, "events", events);
    }

    @Transactional
    public Map<String, Object> approve(UUID id, long expectedVersion, String comment, Integer requestedQuantity) {
        var current = lock(id);
        validateVersion(current, expectedVersion);
        Actor actor = Actor.current();
        if (actor.hasRole("ADMIN")) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", "ADMIN cannot approve recommendations");
        }
        boolean manager = actor.hasRole("SUPPLY_MANAGER");
        boolean planner = actor.hasRole("PLANNER");
        if (!manager && !planner) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", "a planner or supply manager role is required");
        }
        String from = String.valueOf(current.get("status"));
        ensureOpen(from);
        if (requestedQuantity != null && !manager) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", "only a supply manager can change the quantity");
        }
        if ("PENDING_MANAGER".equals(from) && !manager) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", "this order is above the planner limit and needs a supply manager");
        }
        if (manager && actor.username().equals(current.get("endorsedBy"))) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", "the person who endorsed an order cannot give final approval");
        }
        int previousQuantity = ((Number) current.get("quantity")).intValue();
        int quantity = requestedQuantity == null ? previousQuantity : requestedQuantity;
        if (quantity <= 0) {
            throw ApiException.badRequest("quantity must be greater than zero");
        }
        BigDecimal unitCost = (BigDecimal) current.get("unitCost");
        BigDecimal freight = current.get("freightCost") == null
                ? BigDecimal.ZERO
                : (BigDecimal) current.get("freightCost");
        BigDecimal value = unitCost.multiply(BigDecimal.valueOf(quantity)).add(freight);
        BigDecimal plannerLimit = jdbc.sql("SELECT value FROM app.setting WHERE key = 'planner_limit_usd'")
                .query(BigDecimal.class)
                .optional()
                .orElseThrow(() -> new IllegalStateException("planner_limit_usd setting is missing"));
        String to = manager || value.compareTo(plannerLimit) <= 0 ? "APPROVED" : "PENDING_MANAGER";
        String endorsedBy = "PENDING_MANAGER".equals(to) ? actor.username() : current.get("endorsedBy") == null
                ? null
                : String.valueOf(current.get("endorsedBy"));
        String decidedBy = "APPROVED".equals(to) ? actor.username() : null;
        long version = expectedVersion + 1;
        int changed = jdbc.sql("""
                UPDATE app.recommendation
                SET status = :status, quantity = :quantity, endorsed_by = :endorsedBy,
                    decided_by = :decidedBy, version = version + 1, updated_at = now()
                WHERE recommendation_id = :id AND version = :version
                """)
                .param("status", to)
                .param("quantity", quantity)
                .param("endorsedBy", endorsedBy)
                .param("decidedBy", decidedBy)
                .param("id", id)
                .param("version", expectedVersion)
                .update();
        if (changed != 1) {
            throw ApiException.preconditionFailed("recommendation changed; reload and try again");
        }
        String orderId = null;
        if ("APPROVED".equals(to)) {
            String prefix = "TRANSFER".equals(current.get("kind")) ? "DTO" : "DPO";
            String sequence = "TRANSFER".equals(current.get("kind")) ? "app.transfer_order_number" : "app.purchase_order_number";
            long number = jdbc.sql("SELECT nextval('" + sequence + "')").query(Long.class).single();
            orderId = prefix + "-" + String.format("%06d", number);
            jdbc.sql("""
                    INSERT INTO app.draft_order
                        (order_id, kind, recommendation_id, sku, warehouse_id, source_warehouse_id,
                         supplier_id, quantity, total_value, freight_cost, expected_arrival, created_by)
                    VALUES (:orderId, :kind, :recommendationId, :sku, :warehouseId, :sourceWarehouseId,
                            :supplierId, :quantity, :totalValue, :freightCost, :expectedArrival, :actor)
                    """)
                    .param("orderId", orderId)
                    .param("kind", "TRANSFER".equals(current.get("kind")) ? "TRANSFER" : "PURCHASE")
                    .param("recommendationId", id)
                    .param("sku", current.get("sku"))
                    .param("warehouseId", current.get("warehouseId"))
                    .param("sourceWarehouseId", current.get("sourceWarehouseId"))
                    .param("supplierId", current.get("supplierId"))
                    .param("quantity", quantity)
                    .param("totalValue", value)
                    .param("freightCost", freight)
                    .param("expectedArrival", current.get("expectedArrival"))
                    .param("actor", actor.username())
                    .update();
        }
        recordEvent(id, from, to, actor, comment, previousQuantity, quantity);
        Map<String, Object> before = state(current);
        var after = new java.util.LinkedHashMap<String, Object>();
        after.put("status", to);
        after.put("quantity", quantity);
        after.put("totalValue", value);
        after.put("endorsedBy", endorsedBy);
        after.put("decidedBy", decidedBy);
        after.put("version", version);
        after.put("draftOrderId", orderId);
        after.put("comment", comment);
        String action = "PENDING_MANAGER".equals(to)
                ? "RECOMMENDATION_ENDORSED"
                : requestedQuantity != null && quantity != previousQuantity
                        ? "RECOMMENDATION_OVERRIDDEN"
                        : "RECOMMENDATION_APPROVED";
        audit.record(action, "recommendation", id.toString(), before, after);
        var result = new java.util.LinkedHashMap<String, Object>();
        result.put("recommendation", find(id, false));
        result.put("draftOrderId", orderId);
        return result;
    }

    @Transactional
    public Map<String, Object> reject(UUID id, long expectedVersion, String comment) {
        if (comment == null || comment.isBlank()) {
            throw ApiException.badRequest("comment must not be blank");
        }
        var current = lock(id);
        validateVersion(current, expectedVersion);
        Actor actor = Actor.current();
        if (!actor.hasRole("PLANNER") && !actor.hasRole("SUPPLY_MANAGER")) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", "a planner or supply manager role is required");
        }
        String from = String.valueOf(current.get("status"));
        ensureOpen(from);
        if ("PENDING_MANAGER".equals(from) && !actor.hasRole("SUPPLY_MANAGER")) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "Forbidden", "only a supply manager can reject an endorsed order");
        }
        jdbc.sql("""
                UPDATE app.recommendation SET status = 'REJECTED', decided_by = :actor,
                    version = version + 1, updated_at = now()
                WHERE recommendation_id = :id AND version = :version
                """)
                .param("actor", actor.username())
                .param("id", id)
                .param("version", expectedVersion)
                .update();
        int quantity = ((Number) current.get("quantity")).intValue();
        recordEvent(id, from, "REJECTED", actor, comment, quantity, quantity);
        Map<String, Object> after = Map.of(
                "status", "REJECTED",
                "quantity", quantity,
                "version", expectedVersion + 1,
                "decidedBy", actor.username(),
                "comment", comment);
        audit.record("RECOMMENDATION_REJECTED", "recommendation", id.toString(), state(current), after);
        var result = new java.util.LinkedHashMap<String, Object>();
        result.put("recommendation", find(id, false));
        result.put("draftOrderId", null);
        return result;
    }

    public long version(UUID id) {
        return jdbc.sql("SELECT version FROM app.recommendation WHERE recommendation_id = :id")
                .param("id", id)
                .query(Long.class)
                .optional()
                .orElseThrow(() -> ApiException.notFound("recommendation " + id + " was not found"));
    }

    private java.util.Map<String, Object> lock(UUID id) {
        return jdbc.sql("""
                SELECT r.recommendation_id AS "recommendationId", r.run_id AS "runId", r.kind, r.sku,
                    p.product_name AS "productName", r.warehouse_id AS "warehouseId",
                    r.source_warehouse_id AS "sourceWarehouseId", r.supplier_id AS "supplierId",
                    r.quantity, r.unit_cost AS "unitCost", r.freight_cost AS "freightCost",
                    r.distance_miles AS "distanceMiles", r.lead_days AS "leadDays",
                    r.expected_arrival AS "expectedArrival", r.risk_level AS "riskLevel",
                    r.reason, r.status, r.endorsed_by AS "endorsedBy", r.decided_by AS "decidedBy",
                    r.version, (r.quantity * r.unit_cost + COALESCE(r.freight_cost, 0)) AS "totalValue"
                FROM app.recommendation r JOIN core.dim_product p ON p.sku = r.sku
                WHERE r.recommendation_id = :id FOR UPDATE OF r
                """)
                .param("id", id)
                .query((rs, row) -> recommendationRow(rs))
                .optional()
                .orElseThrow(() -> ApiException.notFound("recommendation " + id + " was not found"));
    }

    private Map<String, Object> find(UUID id, boolean forUpdate) {
        String suffix = forUpdate ? " FOR UPDATE OF r" : "";
        return jdbc.sql("""
                SELECT r.recommendation_id AS "recommendationId", r.run_id AS "runId", r.kind, r.sku,
                    p.product_name AS "productName", r.warehouse_id AS "warehouseId",
                    r.source_warehouse_id AS "sourceWarehouseId", r.supplier_id AS "supplierId",
                    r.quantity, r.unit_cost AS "unitCost", r.freight_cost AS "freightCost",
                    r.distance_miles AS "distanceMiles", r.lead_days AS "leadDays",
                    r.expected_arrival AS "expectedArrival", r.risk_level AS "riskLevel",
                    r.reason, r.status, r.endorsed_by AS "endorsedBy", r.decided_by AS "decidedBy",
                    r.version, (r.quantity * r.unit_cost + COALESCE(r.freight_cost, 0)) AS "totalValue"
                FROM app.recommendation r JOIN core.dim_product p ON p.sku = r.sku
                WHERE r.recommendation_id = :id
                """ + suffix)
                .param("id", id)
                .query((rs, row) -> recommendationRow(rs))
                .optional()
                .orElseThrow(() -> ApiException.notFound("recommendation " + id + " was not found"));
    }

    private Map<String, Object> recommendationRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        var result = new java.util.LinkedHashMap<String, Object>();
        for (String column : List.of("recommendationId", "kind", "sku", "productName", "warehouseId",
                "sourceWarehouseId", "supplierId", "quantity", "unitCost", "totalValue", "freightCost",
                "distanceMiles", "leadDays", "expectedArrival", "riskLevel", "reason", "status",
                "endorsedBy", "decidedBy", "version")) {
            result.put(column, rs.getObject(column));
        }
        return result;
    }

    private List<String> parseStatuses(String value) {
        List<String> statuses = value == null || value.isBlank()
                ? List.of("PENDING_REVIEW", "PENDING_MANAGER")
                : java.util.Arrays.stream(value.split(",")).map(String::trim).distinct().toList();
        if (statuses.isEmpty() || statuses.stream().anyMatch(status -> !STATUSES.contains(status))) {
            throw ApiException.badRequest("status contains an unsupported recommendation state");
        }
        return statuses;
    }

    private List<String> parseJsonRoles(String value) {
        try {
            return objectMapper.readValue(value, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("stored recommendation roles are not valid JSON", exception);
        }
    }

    private void validateVersion(Map<String, Object> current, long expectedVersion) {
        if (((Number) current.get("version")).longValue() != expectedVersion) {
            throw ApiException.preconditionFailed("recommendation changed since version "
                    + expectedVersion + "; reload and try again");
        }
    }

    private void ensureOpen(String status) {
        if (!List.of("PENDING_REVIEW", "PENDING_MANAGER").contains(status)) {
            throw ApiException.conflict("recommendation is already " + status);
        }
    }

    private void recordEvent(
            UUID id, String from, String to, Actor actor, String comment, Integer before, Integer after) {
        try {
            jdbc.sql("""
                    INSERT INTO app.recommendation_event
                        (recommendation_id, from_status, to_status, actor, actor_roles, comment,
                         quantity_before, quantity_after)
                    VALUES (:id, :from, :to, :actor, CAST(:roles AS jsonb), :comment, :before, :after)
                    """)
                    .param("id", id)
                    .param("from", from)
                    .param("to", to)
                    .param("actor", actor.username())
                    .param("roles", objectMapper.writeValueAsString(actor.roles()))
                    .param("comment", comment)
                    .param("before", before)
                    .param("after", after)
                    .update();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("recommendation event roles could not be serialized", exception);
        }
    }

    private Map<String, Object> state(Map<String, Object> recommendation) {
        var state = new java.util.LinkedHashMap<String, Object>();
        for (String key : List.of("status", "quantity", "totalValue", "endorsedBy", "decidedBy", "version")) {
            state.put(key, recommendation.get(key));
        }
        return state;
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
