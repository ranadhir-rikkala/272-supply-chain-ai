package com.supplychain.platform.service;

import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Service
public class ForecastClient {
    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE = new ParameterizedTypeReference<>() {};

    private final RestClient restClient;
    private final CircuitBreaker circuitBreaker;
    private final String serviceToken;
    private final JdbcClient jdbc;

    public ForecastClient(
            RestClient.Builder builder,
            MeterRegistry meterRegistry,
            JdbcClient jdbc,
            @Value("${platform.forecast.base-url}") String baseUrl,
            @Value("${platform.forecast.service-token}") String serviceToken,
            @Value("${platform.forecast.connect-timeout:2s}") Duration connectTimeout,
            @Value("${platform.forecast.read-timeout:5s}") Duration readTimeout) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(connectTimeout);
        requestFactory.setReadTimeout(readTimeout);
        this.restClient = builder.baseUrl(baseUrl).requestFactory(requestFactory).build();
        this.serviceToken = serviceToken;
        this.jdbc = jdbc;
        CircuitBreakerConfig config = CircuitBreakerConfig.custom()
                .slidingWindowSize(4)
                .minimumNumberOfCalls(3)
                .failureRateThreshold(50)
                .waitDurationInOpenState(Duration.ofSeconds(30))
                .permittedNumberOfCallsInHalfOpenState(2)
                .build();
        CircuitBreakerRegistry registry = CircuitBreakerRegistry.of(config);
        this.circuitBreaker = registry.circuitBreaker("forecast-service");
        for (CircuitBreaker.State state : CircuitBreaker.State.values()) {
            Gauge.builder("resilience4j.circuitbreaker.state", circuitBreaker,
                            breaker -> breaker.getState() == state ? 1 : 0)
                    .tag("name", circuitBreaker.getName())
                    .tag("state", state.name().toLowerCase(java.util.Locale.ROOT))
                    .register(meterRegistry);
        }
    }

    public Map<String, Object> series(String sku, String warehouseId, int historyDays, String requestId) {
        Map<String, Object> result = execute(() -> restClient.get()
                .uri("/v1/series/{sku}/{warehouse}?history_days={days}", sku, warehouseId, historyDays)
                .headers(headers -> addHeaders(headers, requestId))
                .retrieve()
                .body(MAP_TYPE));
        if (result == null) {
            throw new IllegalStateException("forecast service returned an empty series response");
        }
        return result;
    }

    public Map<String, Object> requestRun(String requestedBy, String requestId) {
        return execute(() -> restClient.post()
                .uri("/v1/forecast-runs")
                .headers(headers -> addHeaders(headers, requestId))
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("requested_by", requestedBy, "horizon_days", 28))
                .retrieve()
                .body(MAP_TYPE));
    }

    public Map<String, Object> models(String requestId) {
        return execute(() -> restClient.get()
                .uri("/v1/models")
                .headers(headers -> addHeaders(headers, requestId))
                .retrieve()
                .body(MAP_TYPE));
    }

    public Map<String, Object> activate(String version, String requestedBy, String reason, String requestId) {
        return execute(() -> restClient.post()
                .uri("/v1/models/{version}/activation", version)
                .headers(headers -> addHeaders(headers, requestId))
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("requested_by", requestedBy, "reason", reason))
                .retrieve()
                .body(MAP_TYPE));
    }

    public String circuitState() {
        return circuitBreaker.getState().name();
    }

    public boolean isCircuitOpen() {
        return circuitBreaker.getState() == CircuitBreaker.State.OPEN;
    }

    public Map<String, Object> historicalSeries(String sku, String warehouseId, int historyDays) {
        boolean knownSku = jdbc.sql("SELECT EXISTS (SELECT 1 FROM core.dim_product WHERE sku = :sku)")
                .param("sku", sku)
                .query(Boolean.class)
                .single();
        boolean knownWarehouse = jdbc.sql("SELECT EXISTS (SELECT 1 FROM core.dim_warehouse WHERE warehouse_id = :warehouse)")
                .param("warehouse", warehouseId)
                .query(Boolean.class)
                .single();
        if (!knownSku || !knownWarehouse) {
            throw com.supplychain.platform.api.ApiException.notFound("unknown SKU or warehouse");
        }
        var history = jdbc.sql("""
                WITH latest AS (
                    SELECT max(feed_date) AS last_day FROM core.fact_sales_daily
                    WHERE sku = :sku AND warehouse_id = :warehouse
                )
                SELECT s.feed_date AS date, s.units_sold, s.promo_flag, i.stockout_flag, i.on_hand
                FROM core.fact_sales_daily s
                CROSS JOIN latest
                LEFT JOIN core.fact_inventory_daily i
                    ON i.feed_date = s.feed_date AND i.sku = s.sku AND i.warehouse_id = s.warehouse_id
                WHERE s.sku = :sku AND s.warehouse_id = :warehouse
                  AND s.feed_date > latest.last_day - :historyDays
                ORDER BY s.feed_date
                """)
                .param("sku", sku)
                .param("warehouse", warehouseId)
                .param("historyDays", historyDays)
                .query((rs, row) -> {
                    var point = new java.util.LinkedHashMap<String, Object>();
                    point.put("date", rs.getObject("date"));
                    point.put("units_sold", rs.getInt("units_sold"));
                    point.put("promo_flag", rs.getBoolean("promo_flag"));
                    point.put("stockout_flag", rs.getObject("stockout_flag"));
                    point.put("on_hand", rs.getObject("on_hand"));
                    return point;
                })
                .list();
        var backtest = jdbc.sql("""
                SELECT b.target_date AS date, b.actual, b.yhat, b.baseline
                FROM ml.backtest b
                JOIN ml.model_version m ON m.model_version = b.model_version AND m.status = 'ACTIVE'
                WHERE b.sku = :sku AND b.warehouse_id = :warehouse
                ORDER BY b.target_date
                """)
                .param("sku", sku)
                .param("warehouse", warehouseId)
                .query((rs, row) -> {
                    var point = new java.util.LinkedHashMap<String, Object>();
                    point.put("date", rs.getObject("date"));
                    point.put("actual", rs.getObject("actual"));
                    point.put("yhat", rs.getDouble("yhat"));
                    point.put("baseline", rs.getObject("baseline"));
                    return point;
                })
                .list();
        var result = new java.util.LinkedHashMap<String, Object>();
        result.put("history", history);
        result.put("backtest", backtest);
        result.put("forecast", java.util.List.of());
        return result;
    }

    private <T> T execute(java.util.function.Supplier<T> operation) {
        if (serviceToken == null || serviceToken.length() < 16) {
            throw new ForecastUnavailableException(
                    "FORECAST_SERVICE_TOKEN must be set to at least 16 characters",
                    new IllegalStateException("forecast service token is not configured"));
        }
        try {
            return circuitBreaker.executeSupplier(operation);
        } catch (CallNotPermittedException exception) {
            throw new ForecastUnavailableException("forecast service circuit is open", exception);
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().is5xxServerError()) {
                throw new ForecastUnavailableException("forecast service returned an error", exception);
            }
            throw new com.supplychain.platform.api.ApiException(
                    org.springframework.http.HttpStatus.valueOf(exception.getStatusCode().value()),
                    "Forecast Service Error",
                    "forecast service rejected the request with status " + exception.getStatusCode().value());
        } catch (RestClientException exception) {
            throw new ForecastUnavailableException("forecast service request failed", exception);
        }
    }

    private void addHeaders(HttpHeaders headers, String requestId) {
        headers.setBearerAuth(serviceToken);
        headers.set("X-Request-ID", requestId == null || requestId.isBlank()
                ? UUID.randomUUID().toString()
                : requestId);
    }

    public static class ForecastUnavailableException extends RuntimeException {
        public ForecastUnavailableException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
