package com.supplychain.platform.api;

import com.supplychain.platform.service.AuditService;
import com.supplychain.platform.service.EvaluationService;
import com.supplychain.platform.service.ForecastClient;
import com.supplychain.platform.service.OptimizationService;
import com.supplychain.platform.service.PlatformReadService;
import com.supplychain.platform.service.RecommendationService;
import com.supplychain.platform.service.SettingService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class PlatformController {
    private final PlatformReadService readService;
    private final RecommendationService recommendationService;
    private final SettingService settingService;
    private final OptimizationService optimizationService;
    private final ForecastClient forecastClient;
    private final EvaluationService evaluationService;
    private final AuditService auditService;
    private final HttpServletRequest request;

    public PlatformController(
            PlatformReadService readService,
            RecommendationService recommendationService,
            SettingService settingService,
            OptimizationService optimizationService,
            ForecastClient forecastClient,
            EvaluationService evaluationService,
            AuditService auditService,
            HttpServletRequest request) {
        this.readService = readService;
        this.recommendationService = recommendationService;
        this.settingService = settingService;
        this.optimizationService = optimizationService;
        this.forecastClient = forecastClient;
        this.evaluationService = evaluationService;
        this.auditService = auditService;
        this.request = request;
    }

    @GetMapping("/me")
    public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
        String username = jwt.getClaimAsString("preferred_username");
        String displayName = jwt.getClaimAsString("name");
        var result = new LinkedHashMap<String, Object>();
        result.put("username", username == null ? jwt.getSubject() : username);
        result.put("displayName", displayName == null ? (username == null ? jwt.getSubject() : username) : displayName);
        result.put("email", jwt.getClaimAsString("email"));
        result.put("roles", Actor.current().roles());
        return result;
    }

    @GetMapping("/dashboard/summary")
    public Map<String, Object> summary() {
        return readService.summary();
    }

    @GetMapping("/warehouses")
    public List<Map<String, Object>> warehouses() {
        return readService.warehouses();
    }

    @GetMapping("/risks")
    public PageResponse<Map<String, Object>> risks(
            @RequestParam(required = false) String level,
            @RequestParam(required = false) String warehouseId,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return readService.risks(level, warehouseId, category, search, page, size);
    }

    @GetMapping("/risks/{sku}/{warehouseId}")
    public Map<String, Object> risk(@PathVariable String sku, @PathVariable String warehouseId) {
        return readService.riskDetail(sku, warehouseId);
    }

    @GetMapping("/series/{sku}/{warehouseId}")
    public Map<String, Object> series(
            @PathVariable String sku,
            @PathVariable String warehouseId,
            @RequestParam(defaultValue = "120") int historyDays) {
        if (historyDays < 1 || historyDays > 365) {
            throw ApiException.badRequest("historyDays must be between 1 and 365");
        }
        String requestId = String.valueOf(request.getAttribute(RequestIdFilter.ATTRIBUTE));
        try {
            Map<String, Object> remote = forecastClient.series(sku, warehouseId, historyDays, requestId);
            var data = new LinkedHashMap<String, Object>();
            data.put("history", remote.getOrDefault("history", List.of()));
            data.put("backtest", remote.getOrDefault("backtest", List.of()));
            data.put("forecast", remote.getOrDefault("forecast", List.of()));
            return Map.of("forecastAvailable", true, "data", data);
        } catch (ForecastClient.ForecastUnavailableException exception) {
            Map<String, Object> history = forecastClient.historicalSeries(sku, warehouseId, historyDays);
            return Map.of(
                    "forecastAvailable", false,
                    "reason", exception.getMessage(),
                    "data", history);
        }
    }

    @GetMapping("/recommendations")
    public PageResponse<Map<String, Object>> recommendations(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String warehouseId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return recommendationService.list(status, kind, warehouseId, page, size);
    }

    @GetMapping("/recommendations/{id}")
    public ResponseEntity<Map<String, Object>> recommendation(@PathVariable UUID id) {
        Map<String, Object> body = recommendationService.detail(id);
        long version = ((Number) ((Map<?, ?>) body.get("recommendation")).get("version")).longValue();
        return ResponseEntity.ok().eTag(IfMatch.etag(version)).body(body);
    }

    @PostMapping("/recommendations/{id}/approve")
    @PreAuthorize("hasAnyRole('PLANNER', 'SUPPLY_MANAGER')")
    public ResponseEntity<Map<String, Object>> approve(
            @PathVariable UUID id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody(required = false) ApproveRequest body) {
        long version = IfMatch.requireVersion(ifMatch);
        Map<String, Object> result = recommendationService.approve(
                id,
                version,
                body == null ? null : body.comment(),
                body == null ? null : body.quantity());
        Map<?, ?> recommendation = (Map<?, ?>) result.get("recommendation");
        long updatedVersion = ((Number) recommendation.get("version")).longValue();
        return ResponseEntity.ok().eTag(IfMatch.etag(updatedVersion)).body(result);
    }

    @PostMapping("/recommendations/{id}/reject")
    @PreAuthorize("hasAnyRole('PLANNER', 'SUPPLY_MANAGER')")
    public ResponseEntity<Map<String, Object>> reject(
            @PathVariable UUID id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody RejectRequest body) {
        Map<String, Object> result = recommendationService.reject(id, IfMatch.requireVersion(ifMatch), body.comment());
        Map<?, ?> recommendation = (Map<?, ?>) result.get("recommendation");
        long updatedVersion = ((Number) recommendation.get("version")).longValue();
        return ResponseEntity.ok().eTag(IfMatch.etag(updatedVersion)).body(result);
    }

    @GetMapping("/orders")
    public PageResponse<Map<String, Object>> orders(
            @RequestParam(required = false) String kind,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return readService.orders(kind, page, size);
    }

    @GetMapping("/audit")
    @PreAuthorize("hasAnyRole('SUPPLY_MANAGER', 'ADMIN')")
    public PageResponse<Map<String, Object>> audit(
            @RequestParam(required = false) String entityType,
            @RequestParam(required = false) String actor,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        if (page < 0 || page > 1_000_000 || size < 1 || size > 500) {
            throw ApiException.badRequest("page must be non-negative and size must be between 1 and 500");
        }
        List<Map<String, Object>> items = auditService.list(entityType, actor, page, size);
        return PageResponse.of(items, page, size, auditService.count(entityType, actor));
    }

    @GetMapping("/settings")
    public List<Map<String, Object>> settings() {
        return settingService.list();
    }

    @PutMapping("/settings/{key}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> updateSetting(
            @PathVariable String key,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody SettingUpdateRequest body) {
        Map<String, Object> setting = settingService.update(key, body.value(), IfMatch.requireVersion(ifMatch));
        return ResponseEntity.ok()
                .eTag(IfMatch.etag(((Number) setting.get("version")).longValue()))
                .body(setting);
    }

    @PostMapping("/optimization-runs")
    @PreAuthorize("hasAnyRole('PLANNER', 'ADMIN')")
    public Map<String, Object> optimize() {
        return optimizationService.run();
    }

    @GetMapping("/jobs")
    public List<Map<String, Object>> jobs(@RequestParam(defaultValue = "40") int limit) {
        return readService.jobs(limit);
    }

    @GetMapping("/quality")
    public Map<String, Object> quality() {
        return readService.quality();
    }

    @GetMapping("/models")
    public Map<String, Object> models() {
        Map<String, Object> response = forecastClient.models(requestId());
        Object rawItems = response.get("items");
        List<Map<String, Object>> items = rawItems instanceof List<?> values
                ? values.stream().filter(Map.class::isInstance).map(value -> modelRow((Map<?, ?>) value)).toList()
                : List.of();
        return Map.of("items", items, "limit", items.size(), "offset", 0, "total", items.size());
    }

    @PostMapping("/models/{version}/activation")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> activate(
            @PathVariable String version, @Valid @RequestBody ActivationRequest body) {
        Map<String, Object> result = forecastClient.activate(
                version, Actor.current().username(), body.reason(), requestId());
        auditService.record("MODEL_ACTIVATED", "model_version", version, null, result);
        return result;
    }

    @PostMapping("/forecast-runs")
    @PreAuthorize("hasAnyRole('PLANNER', 'ADMIN')")
    public ResponseEntity<Map<String, Object>> requestForecast() {
        Map<String, Object> result = forecastClient.requestRun(Actor.current().username(), requestId());
        Object runId = result.get("run_id");
        if (runId != null) {
            auditService.record("FORECAST_RUN_REQUESTED", "forecast_run", String.valueOf(runId), null, result);
        }
        return ResponseEntity.accepted()
                .location(URI.create("/api/v1/jobs"))
                .body(result);
    }

    @GetMapping("/evaluation/risk-flags")
    public Map<String, Object> evaluation() {
        return evaluationService.latest();
    }

    @PostMapping("/evaluation/risk-flags")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> evaluate() {
        return evaluationService.run();
    }

    private String requestId() {
        return String.valueOf(request.getAttribute(RequestIdFilter.ATTRIBUTE));
    }

    private Map<String, Object> modelRow(Map<?, ?> source) {
        Object weeklyWape = source.get("weekly_wape");
        Object baselineWeeklyWape = source.get("baseline_weekly_wape");
        Object dailyWape = source.get("daily_wape");
        Object baselineDailyWape = source.get("baseline_daily_wape");
        var weekly = new LinkedHashMap<String, Object>();
        weekly.put("wape", weeklyWape);
        weekly.put("baseline_wape", baselineWeeklyWape);
        var daily = new LinkedHashMap<String, Object>();
        daily.put("wape", dailyWape);
        daily.put("baseline_wape", baselineDailyWape);
        var result = new LinkedHashMap<String, Object>();
        result.put("model_version", source.get("model_version"));
        result.put("algorithm", "XGBoost");
        result.put("status", source.get("status"));
        result.put("passed_gate", source.get("passed_gate"));
        result.put("metrics", Map.of("weekly", weekly, "daily", daily));
        result.put("created_at", source.get("created_at"));
        result.put("status_reason", source.get("status_reason"));
        return result;
    }

    public record ApproveRequest(
            @Size(max = 500) String comment,
            @Positive Integer quantity) {}

    public record RejectRequest(@NotBlank @Size(max = 500) String comment) {}

    public record SettingUpdateRequest(@NotNull BigDecimal value) {}

    public record ActivationRequest(@NotBlank @Size(min = 3, max = 500) String reason) {}
}
