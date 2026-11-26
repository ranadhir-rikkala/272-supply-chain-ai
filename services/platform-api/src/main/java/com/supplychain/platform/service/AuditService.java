package com.supplychain.platform.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.supplychain.platform.api.Actor;
import com.supplychain.platform.api.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final HttpServletRequest request;

    public AuditService(JdbcClient jdbc, ObjectMapper objectMapper, HttpServletRequest request) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.request = request;
    }

    public void record(String action, String entityType, String entityId, Object before, Object after) {
        Actor actor = Actor.current();
        try {
            jdbc.sql("""
                    INSERT INTO app.audit_log
                        (actor, actor_roles, action, entity_type, entity_id, "before", "after", request_id)
                    VALUES (:actor, CAST(:roles AS jsonb), :action, :entityType, :entityId,
                            CAST(:before AS jsonb), CAST(:after AS jsonb), :requestId)
                    """)
                    .param("actor", actor.username())
                    .param("roles", objectMapper.writeValueAsString(actor.roles()))
                    .param("action", action)
                    .param("entityType", entityType)
                    .param("entityId", entityId)
                    .param("before", serialize(before))
                    .param("after", serialize(after))
                    .param("requestId", request.getAttribute(RequestIdFilter.ATTRIBUTE))
                    .update();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("audit record could not be serialized", exception);
        }
    }

    public List<java.util.Map<String, Object>> list(String entityType, String actorName, int page, int size) {
        String filter = " WHERE (CAST(:entityType AS text) IS NULL OR entity_type = :entityType)"
                + " AND (CAST(:actorName AS text) IS NULL OR actor = :actorName)";
        long total = jdbc.sql("SELECT count(*) FROM app.audit_log" + filter)
                .param("entityType", entityType)
                .param("actorName", actorName)
                .query(Long.class)
                .single();
        List<java.util.Map<String, Object>> items = jdbc.sql("""
                SELECT audit_id AS "auditId", occurred_at AS "occurredAt", actor, actor_roles AS "actorRoles",
                       action, entity_type AS "entityType", entity_id AS "entityId",
                       "before"::text AS "before", "after"::text AS "after", request_id AS "requestId"
                FROM app.audit_log
                """ + filter + " ORDER BY occurred_at DESC, audit_id DESC OFFSET :offset LIMIT :size")
                .param("entityType", entityType)
                .param("actorName", actorName)
                .param("offset", (long) page * size)
                .param("size", size)
                .query((rs, row) -> {
                    java.util.Map<String, Object> result = new java.util.LinkedHashMap<>();
                    result.put("auditId", rs.getLong("auditId"));
                    result.put("occurredAt", rs.getObject("occurredAt"));
                    result.put("actor", rs.getString("actor"));
                    try {
                        result.put("actorRoles", objectMapper.readValue(rs.getString("actorRoles"), List.class));
                    } catch (JsonProcessingException exception) {
                        throw new IllegalStateException("stored audit roles are not valid JSON", exception);
                    }
                    result.put("action", rs.getString("action"));
                    result.put("entityType", rs.getString("entityType"));
                    result.put("entityId", rs.getString("entityId"));
                    result.put("before", rs.getString("before"));
                    result.put("after", rs.getString("after"));
                    result.put("requestId", rs.getString("requestId"));
                    return result;
                })
                .list();
        return items;
    }

    public long count(String entityType, String actorName) {
        String filter = " WHERE (CAST(:entityType AS text) IS NULL OR entity_type = :entityType)"
                + " AND (CAST(:actorName AS text) IS NULL OR actor = :actorName)";
        return jdbc.sql("SELECT count(*) FROM app.audit_log" + filter)
                .param("entityType", entityType)
                .param("actorName", actorName)
                .query(Long.class)
                .single();
    }

    private String serialize(Object value) throws JsonProcessingException {
        return value == null ? null : objectMapper.writeValueAsString(value);
    }
}
