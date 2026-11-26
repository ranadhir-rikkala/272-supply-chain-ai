package com.supplychain.platform;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;

@SpringBootTest(properties = "spring.flyway.enabled=false")
@AutoConfigureMockMvc
class PlatformApiIntegrationTest {
    private static final String EXTERNAL_DATABASE_URL = System.getenv("PLATFORM_TEST_DATABASE_URL");
    private static final boolean USE_EXTERNAL_DATABASE = EXTERNAL_DATABASE_URL != null;
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("supplychain")
                    .withUsername("supplychain")
                    .withPassword("test-password");

    static {
        if (!USE_EXTERNAL_DATABASE) {
            POSTGRES.start();
        }
        Path migrations = findMigrations();
        String databaseUrl = USE_EXTERNAL_DATABASE ? EXTERNAL_DATABASE_URL : POSTGRES.getJdbcUrl();
        String databaseUsername = USE_EXTERNAL_DATABASE
                ? System.getenv("PLATFORM_TEST_DATABASE_USERNAME")
                : POSTGRES.getUsername();
        String databasePassword = USE_EXTERNAL_DATABASE
                ? System.getenv("PLATFORM_TEST_DATABASE_PASSWORD")
                : POSTGRES.getPassword();
        Flyway.configure()
                .dataSource(databaseUrl, databaseUsername, databasePassword)
                .locations("filesystem:" + migrations)
                .outOfOrder(true)
                .placeholders(Map.of(
                        "forecast_db_password", "forecast-test-password",
                        "grafana_db_password", "grafana-test-password",
                        "api_db_password", "platform-test-password"))
                .load()
                .migrate();
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> USE_EXTERNAL_DATABASE
                ? EXTERNAL_DATABASE_URL
                : POSTGRES.getJdbcUrl());
        registry.add("spring.datasource.username", () -> USE_EXTERNAL_DATABASE
                ? System.getenv("PLATFORM_TEST_DATABASE_USERNAME")
                : POSTGRES.getUsername());
        registry.add("spring.datasource.password", () -> USE_EXTERNAL_DATABASE
                ? System.getenv("PLATFORM_TEST_DATABASE_PASSWORD")
                : POSTGRES.getPassword());
        registry.add("platform.security.issuer-uri", () -> "http://localhost/auth/realms/supplychain");
        registry.add("platform.security.jwk-set-uri",
                () -> "http://localhost/auth/realms/supplychain/protocol/openid-connect/certs");
        registry.add("platform.forecast.service-token", () -> "test-forecast-service-token");
    }

    @AfterAll
    static void stopPostgres() {
        if (!USE_EXTERNAL_DATABASE) {
            POSTGRES.stop();
        }
    }

    @BeforeEach
    void seedRecommendationDimensions() {
        jdbc.update("""
                INSERT INTO core.dim_supplier
                    (supplier_id, supplier_name, region, lead_time_mean, lead_time_sd)
                VALUES ('SUP-TEST', 'Test Supplier', 'US-EAST', 4, 1)
                ON CONFLICT (supplier_id) DO NOTHING
                """);
        jdbc.update("""
                INSERT INTO core.dim_product
                    (sku, category, product_name, supplier_id, case_pack, unit_cost, unit_price)
                VALUES ('TEST-0001', 'BEV', 'Test Product', 'SUP-TEST', 6, 10, 15)
                ON CONFLICT (sku) DO NOTHING
                """);
        jdbc.update("""
                INSERT INTO core.dim_warehouse
                    (warehouse_id, warehouse_name, city, latitude, longitude, climate_scale)
                VALUES ('WH-TEST', 'Test Warehouse', 'Test City', 40, -74, 1)
                ON CONFLICT (warehouse_id) DO NOTHING
                """);
    }

    @Test
    void returnsRfc9457UnauthorizedWithRequestId() throws Exception {
        mockMvc.perform(get("/api/v1/me").header("X-Request-ID", "integration-request"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(header().string("X-Request-ID", "integration-request"))
                .andExpect(content().json("""
                        {"title":"Unauthorized","status":401,"requestId":"integration-request"}
                        """));
    }

    @Test
    void auditTrailIsRestrictedToManagersAndAdmins() throws Exception {
        mockMvc.perform(get("/api/v1/audit").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_VIEWER"))))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));

        mockMvc.perform(get("/api/v1/audit").with(jwt().authorities(
                        new SimpleGrantedAuthority("ROLE_SUPPLY_MANAGER"))))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.items").isArray())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.page").value(0))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.size").value(50))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.total").value(jdbc.queryForObject("SELECT count(*) FROM app.audit_log", Integer.class)));
    }

    @Test
    void disruptionEvaluationSerializesDatesAndWritesAuditRecord() throws Exception {
        String disruptionId = "TEST-" + UUID.randomUUID();
        jdbc.update("""
                INSERT INTO eval.disruption_truth
                    (disruption_id, disruption_type, start_date, end_date, description)
                VALUES (?, 'TEST', DATE '2099-01-01', DATE '2099-01-02', 'serialization test')
                """, disruptionId);

        mockMvc.perform(post("/api/v1/evaluation/risk-flags")
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_ADMIN")))
                        .header("Idempotency-Key", "evaluation-" + UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString(
                        "\"startDate\":\"2099-01-01\"")));
    }

    @Test
    void staleIfMatchReturnsPreconditionFailed() throws Exception {
        UUID recommendationId = createRecommendation(12, "PENDING_REVIEW", null);
        jdbc.update("UPDATE app.recommendation SET version = 2 WHERE recommendation_id = ?", recommendationId);

        mockMvc.perform(post("/api/v1/recommendations/{id}/approve", recommendationId)
                        .with(jwt().jwt(jwt -> jwt.claim("preferred_username", "pat.planner"))
                                .authorities(new SimpleGrantedAuthority("ROLE_PLANNER")))
                        .header("If-Match", "\"1\"")
                        .header("Idempotency-Key", "stale-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isPreconditionFailed())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));
    }

    @Test
    void plannerApprovesUnderLimitAndCreatesDraftOrder() throws Exception {
        UUID recommendationId = createRecommendation(12, "PENDING_REVIEW", null);

        mockMvc.perform(approveAs(recommendationId, "pat.planner", "PLANNER", "\"1\"", "{}"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.recommendation.status").value("APPROVED"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.draftOrderId").value(org.hamcrest.Matchers.startsWith("DPO-")));

        org.junit.jupiter.api.Assertions.assertEquals(1, jdbc.queryForObject(
                "SELECT count(*) FROM app.draft_order WHERE recommendation_id = ?",
                Integer.class,
                recommendationId));
        org.junit.jupiter.api.Assertions.assertEquals(1, jdbc.queryForObject(
                "SELECT count(*) FROM app.audit_log WHERE entity_id = ? AND action = 'RECOMMENDATION_APPROVED'",
                Integer.class,
                recommendationId.toString()));
    }

    @Test
    void plannerEndorsesOverLimitForSupplyManager() throws Exception {
        UUID recommendationId = createRecommendation(1200, "PENDING_REVIEW", null);

        mockMvc.perform(approveAs(recommendationId, "pat.planner", "PLANNER", "\"1\"", "{}"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.recommendation.status").value("PENDING_MANAGER"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.recommendation.endorsedBy").value("pat.planner"));
        org.junit.jupiter.api.Assertions.assertEquals(0, jdbc.queryForObject(
                "SELECT count(*) FROM app.draft_order WHERE recommendation_id = ?",
                Integer.class,
                recommendationId));
    }

    @Test
    void differentSupplyManagerApprovesEndorsedRecommendation() throws Exception {
        UUID recommendationId = createRecommendation(1200, "PENDING_MANAGER", "pat.planner");

        mockMvc.perform(approveAs(recommendationId, "max.manager", "SUPPLY_MANAGER", "\"1\"", "{}"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.recommendation.status").value("APPROVED"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.draftOrderId").value(org.hamcrest.Matchers.startsWith("DPO-")));
    }

    @Test
    void plannerCannotOverrideRecommendationQuantity() throws Exception {
        UUID recommendationId = createRecommendation(12, "PENDING_REVIEW", null);

        mockMvc.perform(approveAs(
                        recommendationId, "pat.planner", "PLANNER", "\"1\"", "{\"quantity\":24}"))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));
        org.junit.jupiter.api.Assertions.assertEquals(12, jdbc.queryForObject(
                "SELECT quantity FROM app.recommendation WHERE recommendation_id = ?",
                Integer.class,
                recommendationId));
    }

    @Test
    void adminCannotApproveRecommendation() throws Exception {
        UUID recommendationId = createRecommendation(12, "PENDING_REVIEW", null);

        mockMvc.perform(approveAs(recommendationId, "ada.admin", "ADMIN", "\"1\"", "{}"))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));
        org.junit.jupiter.api.Assertions.assertEquals("PENDING_REVIEW", jdbc.queryForObject(
                "SELECT status FROM app.recommendation WHERE recommendation_id = ?",
                String.class,
                recommendationId));
    }

    @Test
    void endorserCannotGiveFinalApproval() throws Exception {
        UUID recommendationId = createRecommendation(1200, "PENDING_MANAGER", "pat.planner");

        mockMvc.perform(post("/api/v1/recommendations/{id}/approve", recommendationId)
                        .with(jwt().jwt(jwt -> jwt.claim("preferred_username", "pat.planner"))
                                .authorities(
                                        new SimpleGrantedAuthority("ROLE_PLANNER"),
                                        new SimpleGrantedAuthority("ROLE_SUPPLY_MANAGER")))
                        .header("If-Match", "\"1\"")
                        .header("Idempotency-Key", "endorser-" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));
        org.junit.jupiter.api.Assertions.assertEquals("PENDING_MANAGER", jdbc.queryForObject(
                "SELECT status FROM app.recommendation WHERE recommendation_id = ?",
                String.class,
                recommendationId));
    }

    @Test
    void supplyManagerCanOverrideQuantityWhenApproving() throws Exception {
        UUID recommendationId = createRecommendation(12, "PENDING_REVIEW", null);

        mockMvc.perform(approveAs(
                        recommendationId, "max.manager", "SUPPLY_MANAGER", "\"1\"", "{\"quantity\":24}"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.recommendation.quantity").value(24))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                        "$.recommendation.status").value("APPROVED"));
    }

    @Test
    void idempotencyReplaysSameResponseAndRejectsChangedBody() throws Exception {
        String key = "optimization-" + UUID.randomUUID();
        var planner = jwt().jwt(jwt -> jwt.claim("preferred_username", "pat.planner"))
                .authorities(new SimpleGrantedAuthority("ROLE_PLANNER"));
        String first = mockMvc.perform(post("/api/v1/optimization-runs")
                        .with(planner)
                        .header("Idempotency-Key", key))
                .andExpect(status().isConflict())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String replay = mockMvc.perform(post("/api/v1/optimization-runs")
                        .with(planner)
                        .header("Idempotency-Key", key))
                .andExpect(status().isConflict())
                .andReturn()
                .getResponse()
                .getContentAsString();
        org.junit.jupiter.api.Assertions.assertEquals(first, replay);

        mockMvc.perform(post("/api/v1/optimization-runs")
                        .with(planner)
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));
    }

    @Test
    void auditRowsCannotBeDeleted() {
        jdbc.update("""
                INSERT INTO app.audit_log (actor, action, entity_type, entity_id)
                VALUES ('test', 'TEST', 'test', ?)
                """, UUID.randomUUID().toString());
        assertThrows(DataAccessException.class, () -> jdbc.update("DELETE FROM app.audit_log"));
    }

    private UUID createRecommendation(int quantity, String status, String endorsedBy) {
        UUID runId = UUID.randomUUID();
        UUID recommendationId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO app.optimization_run
                    (run_id, as_of_date, model_version, status, requested_by)
                VALUES (?, '2025-12-31', 'model-test', 'SUCCEEDED', 'test')
                """, runId);
        jdbc.update("""
                INSERT INTO app.recommendation
                    (recommendation_id, run_id, kind, sku, warehouse_id, supplier_id,
                     quantity, unit_cost, freight_cost, distance_miles, lead_days,
                     expected_arrival, risk_level, reason, status, endorsed_by, version)
                VALUES (?, ?, 'REORDER', 'TEST-0001', 'WH-TEST', 'SUP-TEST',
                        ?, 10, 0, 0, 4, '2026-01-04', 'HIGH', 'Test risk', ?, ?, 1)
                """, recommendationId, runId, quantity, status, endorsedBy);
        return recommendationId;
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder approveAs(
            UUID recommendationId, String username, String role, String ifMatch, String body) {
        return post("/api/v1/recommendations/{id}/approve", recommendationId)
                .with(jwt().jwt(jwt -> jwt.claim("preferred_username", username))
                        .authorities(new SimpleGrantedAuthority("ROLE_" + role)))
                .header("If-Match", ifMatch)
                .header("Idempotency-Key", "approve-" + UUID.randomUUID())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    private static Path findMigrations() {
        Path current = Path.of("").toAbsolutePath();
        while (current != null) {
            Path migrations = current.resolve("db/migrations");
            if (Files.isDirectory(migrations)) {
                return migrations;
            }
            current = current.getParent();
        }
        throw new IllegalStateException("db/migrations could not be located for integration tests");
    }
}
