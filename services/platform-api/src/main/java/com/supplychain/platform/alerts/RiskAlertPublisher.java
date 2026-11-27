package com.supplychain.platform.alerts;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sns.model.MessageAttributeValue;
import software.amazon.awssdk.services.sns.model.PublishBatchRequest;
import software.amazon.awssdk.services.sns.model.PublishBatchRequestEntry;
import software.amazon.awssdk.services.sns.model.PublishBatchResponse;
import software.amazon.awssdk.services.sns.model.PublishRequest;

/**
 * Publishes HIGH-risk alerts to an SNS topic after an optimization run commits: one
 * readable summary (for email subscribers) and one JSON event per item (for queues and
 * other services). Subscribers filter on the {@code event_type} message attribute.
 * Without a topic ARN (local Compose) it only logs. A failure never fails the run.
 */
@Component
public class RiskAlertPublisher {
    static final int BATCH_SIZE = 10;
    private static final Logger log = LoggerFactory.getLogger(RiskAlertPublisher.class);

    private final String topicArn;
    private final String publicUrl;
    private final ObjectMapper objectMapper;
    private final SnsClient sns;
    private final ExecutorService executor;
    private final Counter published;
    private final Counter failed;

    @Autowired
    public RiskAlertPublisher(
            @Value("${platform.alerts.sns-topic-arn:}") String topicArn,
            @Value("${PUBLIC_URL:https://localhost}") String publicUrl,
            ObjectMapper objectMapper,
            MeterRegistry meterRegistry) {
        this(topicArn, publicUrl, objectMapper, meterRegistry,
                topicArn.isBlank() ? null : SnsClient.builder().httpClient(UrlConnectionHttpClient.create()).build(),
                Executors.newSingleThreadExecutor(Thread.ofVirtual().name("risk-alerts").factory()));
    }

    RiskAlertPublisher(
            String topicArn,
            String publicUrl,
            ObjectMapper objectMapper,
            MeterRegistry meterRegistry,
            SnsClient sns,
            ExecutorService executor) {
        this.topicArn = topicArn;
        this.publicUrl = publicUrl;
        this.objectMapper = objectMapper;
        this.sns = sns;
        this.executor = executor;
        this.published = Counter.builder("platform.risk.alerts")
                .description("High-risk alert messages sent to SNS")
                .tag("outcome", "published")
                .register(meterRegistry);
        this.failed = Counter.builder("platform.risk.alerts")
                .description("High-risk alert messages sent to SNS")
                .tag("outcome", "failed")
                .register(meterRegistry);
    }

    /** Runs after commit and hands the work to a background thread so the API answers at once. */
    @TransactionalEventListener
    public void onRiskAlertsRaised(RiskAlertsRaised event) {
        if (sns == null) {
            log.info("risk alerts not sent: no SNS topic configured (run {}, {} high-risk items)",
                    event.runId(), event.alerts().size());
            return;
        }
        executor.execute(() -> publish(event));
    }

    void publish(RiskAlertsRaised event) {
        try {
            sns.publish(PublishRequest.builder()
                    .topicArn(topicArn)
                    .subject(RiskAlertMessages.subject(event))
                    .message(RiskAlertMessages.summary(event, publicUrl))
                    .messageAttributes(Map.of(
                            "event_type", attribute(RiskAlertMessages.SUMMARY_EVENT),
                            "run_id", attribute(event.runId().toString())))
                    .build());
            published.increment();
        } catch (RuntimeException error) {
            failed.increment();
            log.warn("risk alert summary for run {} was not sent", event.runId(), error);
        }

        int sent = 0;
        for (int start = 0; start < event.alerts().size(); start += BATCH_SIZE) {
            List<RiskAlert> batch = event.alerts().subList(start, Math.min(start + BATCH_SIZE, event.alerts().size()));
            sent += sendBatch(event, batch, start);
        }
        log.info("risk alerts for run {}: {} of {} item events published to SNS",
                event.runId(), sent, event.alerts().size());
    }

    private int sendBatch(RiskAlertsRaised event, List<RiskAlert> batch, int offset) {
        List<PublishBatchRequestEntry> entries = new ArrayList<>(batch.size());
        for (int index = 0; index < batch.size(); index++) {
            RiskAlert alert = batch.get(index);
            entries.add(PublishBatchRequestEntry.builder()
                    .id("a" + (offset + index))
                    .message(json(RiskAlertMessages.item(event, alert)))
                    .messageAttributes(Map.of(
                            "event_type", attribute(RiskAlertMessages.ITEM_EVENT),
                            "run_id", attribute(event.runId().toString()),
                            "warehouse_id", attribute(alert.warehouseId()),
                            "category", attribute(alert.category())))
                    .build());
        }
        try {
            PublishBatchResponse response = sns.publishBatch(
                    PublishBatchRequest.builder().topicArn(topicArn).publishBatchRequestEntries(entries).build());
            int ok = response.successful().size();
            published.increment(ok);
            if (!response.failed().isEmpty()) {
                failed.increment(response.failed().size());
                log.warn("risk alerts for run {}: {} item events rejected by SNS, first: {}",
                        event.runId(), response.failed().size(), response.failed().getFirst().message());
            }
            return ok;
        } catch (RuntimeException error) {
            failed.increment(entries.size());
            log.warn("risk alert batch for run {} was not sent", event.runId(), error);
            return 0;
        }
    }

    private String json(Map<String, Object> body) {
        try {
            return objectMapper.writeValueAsString(body);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException(error);
        }
    }

    /** SNS rejects empty attribute values. */
    private static MessageAttributeValue attribute(String value) {
        String text = value == null || value.isBlank() ? "unknown" : value;
        return MessageAttributeValue.builder().dataType("String").stringValue(text).build();
    }

    @PreDestroy
    void close() {
        executor.shutdown();
        if (sns != null) {
            sns.close();
        }
    }
}
