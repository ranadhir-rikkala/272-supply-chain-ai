package com.supplychain.platform.service;

import com.supplychain.platform.api.ApiException;
import com.supplychain.platform.api.IfMatch;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SettingService {
    private final JdbcClient jdbc;
    private final AuditService audit;

    public SettingService(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public List<Map<String, Object>> list() {
        return jdbc.sql("""
                SELECT key, value, description, min AS "minValue", max AS "maxValue",
                       version, updated_at AS "updatedAt", updated_by AS "updatedBy"
                FROM app.setting ORDER BY key
                """)
                .query((rs, row) -> Map.<String, Object>of(
                        "key", rs.getString("key"),
                        "value", rs.getBigDecimal("value"),
                        "description", rs.getString("description"),
                        "minValue", rs.getBigDecimal("minValue"),
                        "maxValue", rs.getBigDecimal("maxValue"),
                        "version", rs.getLong("version"),
                        "updatedAt", rs.getObject("updatedAt"),
                        "updatedBy", rs.getString("updatedBy")))
                .list();
    }

    @Transactional
    public Map<String, Object> update(String key, BigDecimal value, long expectedVersion) {
        var existing = jdbc.sql("""
                SELECT key, value, min, max, version, description, updated_at, updated_by
                FROM app.setting WHERE key = :key FOR UPDATE
                """)
                .param("key", key)
                .query((rs, row) -> Map.<String, Object>of(
                        "key", rs.getString("key"),
                        "value", rs.getBigDecimal("value"),
                        "minValue", rs.getBigDecimal("min"),
                        "maxValue", rs.getBigDecimal("max"),
                        "version", rs.getLong("version"),
                        "description", rs.getString("description"),
                        "updatedAt", rs.getObject("updated_at"),
                        "updatedBy", rs.getString("updated_by")))
                .optional()
                .orElseThrow(() -> ApiException.notFound("setting " + key + " was not found"));
        long currentVersion = ((Number) existing.get("version")).longValue();
        if (currentVersion != expectedVersion) {
            throw ApiException.preconditionFailed("setting changed since version " + expectedVersion + "; reload and try again");
        }
        BigDecimal minimum = (BigDecimal) existing.get("minValue");
        BigDecimal maximum = (BigDecimal) existing.get("maxValue");
        if (value.compareTo(minimum) < 0 || value.compareTo(maximum) > 0) {
            throw ApiException.badRequest("value must be between " + minimum + " and " + maximum);
        }
        Map<String, Object> before = Map.of("value", existing.get("value"), "version", currentVersion);
        String updatedBy = com.supplychain.platform.api.Actor.current().username();
        int updated = jdbc.sql("""
                UPDATE app.setting SET value = :value, version = version + 1,
                    updated_at = now(), updated_by = :updatedBy
                WHERE key = :key AND version = :version
                """)
                .param("value", value)
                .param("updatedBy", updatedBy)
                .param("key", key)
                .param("version", currentVersion)
                .update();
        if (updated != 1) {
            throw ApiException.preconditionFailed("setting changed while it was being updated");
        }
        Map<String, Object> after = Map.of("value", value, "version", currentVersion + 1);
        audit.record("SETTING_CHANGED", "setting", key, before, after);
        return jdbc.sql("""
                SELECT key, value, description, min AS "minValue", max AS "maxValue",
                       version, updated_at AS "updatedAt", updated_by AS "updatedBy"
                FROM app.setting WHERE key = :key
                """)
                .param("key", key)
                .query((rs, row) -> Map.<String, Object>of(
                        "key", rs.getString("key"),
                        "value", rs.getBigDecimal("value"),
                        "description", rs.getString("description"),
                        "minValue", rs.getBigDecimal("minValue"),
                        "maxValue", rs.getBigDecimal("maxValue"),
                        "version", rs.getLong("version"),
                        "updatedAt", rs.getObject("updatedAt"),
                        "updatedBy", rs.getString("updatedBy")))
                .single();
    }

    public long version(String key) {
        return jdbc.sql("SELECT version FROM app.setting WHERE key = :key")
                .param("key", key)
                .query(Long.class)
                .optional()
                .orElseThrow(() -> ApiException.notFound("setting " + key + " was not found"));
    }
}
