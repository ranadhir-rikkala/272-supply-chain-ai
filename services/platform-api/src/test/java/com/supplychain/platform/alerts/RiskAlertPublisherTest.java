package com.supplychain.platform.alerts;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sns.model.BatchResultErrorEntry;
import software.amazon.awssdk.services.sns.model.PublishBatchRequest;
import software.amazon.awssdk.services.sns.model.PublishBatchResponse;
import software.amazon.awssdk.services.sns.model.PublishBatchResultEntry;
import software.amazon.awssdk.services.sns.model.PublishRequest;
import software.amazon.awssdk.services.sns.model.PublishResponse;

class RiskAlertPublisherTest {
    private static final String TOPIC = "arn:aws:sns:us-east-2:123456789012:risk-alerts";
    private static final LocalDate AS_OF = LocalDate.of(2026, 11, 26);

    @Test
    void sendsOneSummaryAndBatchesItemEventsByTen() throws Exception {
        FakeSns sns = new FakeSns();
        SimpleMeterRegistry meters = new SimpleMeterRegistry();
        publisher(sns, meters).publish(event(23));

        assertThat(sns.summaries).hasSize(1);
        PublishRequest summary = sns.summaries.getFirst();
        assertThat(summary.subject()).isEqualTo("Supply chain: 23 high-risk items as of 2026-11-26");
        assertThat(summary.subject().length()).isLessThanOrEqualTo(100);
        assertThat(summary.messageAttributes().get("event_type").stringValue()).isEqualTo("risk.high.summary");
        assertThat(summary.message()).contains("Most urgent 15:", "...and 8 more.", "https://demo.example/approvals");

        assertThat(sns.batches).extracting(batch -> batch.publishBatchRequestEntries().size()).containsExactly(10, 10, 3);
        var first = sns.batches.getFirst().publishBatchRequestEntries().getFirst();
        assertThat(first.messageAttributes().get("event_type").stringValue()).isEqualTo("risk.high");
        assertThat(first.messageAttributes().get("warehouse_id").stringValue()).isEqualTo("WH-01");
        var body = new ObjectMapper().readTree(first.message());
        assertThat(body.get("event").asText()).isEqualTo("risk.high");
        assertThat(body.get("sku").asText()).isEqualTo("SKU-000");
        assertThat(body.get("projected_stockout_date").asText()).isEqualTo("2026-11-27");

        assertThat(meters.counter("platform.risk.alerts", "outcome", "published").count()).isEqualTo(24);
        assertThat(meters.counter("platform.risk.alerts", "outcome", "failed").count()).isZero();
    }

    @Test
    void ordersItemsByEarliestStockoutThenLowestCover() {
        RiskAlert late = alert("SKU-B", LocalDate.of(2026, 12, 5), 9.0);
        RiskAlert none = alert("SKU-C", null, null);
        RiskAlert soonLowCover = alert("SKU-A", LocalDate.of(2026, 11, 28), 1.0);
        RiskAlert soonHighCover = alert("SKU-D", LocalDate.of(2026, 11, 28), 2.0);
        RiskAlertsRaised event = new RiskAlertsRaised(
                UUID.randomUUID(), AS_OF, "m1", "pat.planner", List.of(late, none, soonHighCover, soonLowCover));

        assertThat(event.alerts()).extracting(RiskAlert::sku).containsExactly("SKU-A", "SKU-D", "SKU-B", "SKU-C");
    }

    @Test
    void aFailedSummaryOrRejectedEntriesDoNotStopTheRest() {
        FakeSns sns = new FakeSns();
        sns.failSummary = true;
        sns.rejectPerBatch = 1;
        SimpleMeterRegistry meters = new SimpleMeterRegistry();
        publisher(sns, meters).publish(event(12));

        assertThat(sns.batches).hasSize(2);
        assertThat(meters.counter("platform.risk.alerts", "outcome", "published").count()).isEqualTo(10);
        assertThat(meters.counter("platform.risk.alerts", "outcome", "failed").count()).isEqualTo(3);
    }

    @Test
    void withoutATopicNothingIsSent() {
        FakeSns sns = new FakeSns();
        RiskAlertPublisher publisher = new RiskAlertPublisher(
                "", "https://demo.example", new ObjectMapper(), new SimpleMeterRegistry(), null,
                Executors.newSingleThreadExecutor());
        publisher.onRiskAlertsRaised(event(3));

        assertThat(sns.summaries).isEmpty();
        assertThat(sns.batches).isEmpty();
    }

    @Test
    void blankAttributeValuesAreReplacedBecauseSnsRejectsThem() {
        FakeSns sns = new FakeSns();
        RiskAlert noCategory = new RiskAlert("SKU-X", "WH-02", "Widget", " ", 0, 0, 0.0, AS_OF, 12);
        publisher(sns, new SimpleMeterRegistry())
                .publish(new RiskAlertsRaised(UUID.randomUUID(), AS_OF, "m1", "pat.planner", List.of(noCategory)));

        var entry = sns.batches.getFirst().publishBatchRequestEntries().getFirst();
        assertThat(entry.messageAttributes().get("category").stringValue()).isEqualTo("unknown");
    }

    private static RiskAlertPublisher publisher(SnsClient sns, SimpleMeterRegistry meters) {
        return new RiskAlertPublisher(
                TOPIC, "https://demo.example", new ObjectMapper(), meters, sns, Executors.newSingleThreadExecutor());
    }

    private static RiskAlertsRaised event(int count) {
        List<RiskAlert> alerts = IntStream.range(0, count)
                .mapToObj(i -> new RiskAlert(
                        "SKU-%03d".formatted(i), "WH-01", "Product " + i, "grocery",
                        i, 0, 0.5 + i, AS_OF.plusDays(1 + i), 24))
                .toList();
        return new RiskAlertsRaised(UUID.randomUUID(), AS_OF, "20261127-m1", "pat.planner", alerts);
    }

    private static RiskAlert alert(String sku, LocalDate stockout, Double cover) {
        return new RiskAlert(sku, "WH-01", sku, "grocery", 0, 0, cover, stockout, 12);
    }

    private static final class FakeSns implements SnsClient {
        final List<PublishRequest> summaries = new ArrayList<>();
        final List<PublishBatchRequest> batches = new ArrayList<>();
        boolean failSummary;
        int rejectPerBatch;

        @Override
        public PublishResponse publish(PublishRequest request) {
            if (failSummary) {
                throw new IllegalStateException("SNS unavailable");
            }
            summaries.add(request);
            return PublishResponse.builder().messageId("summary").build();
        }

        @Override
        public PublishBatchResponse publishBatch(PublishBatchRequest request) {
            batches.add(request);
            var entries = request.publishBatchRequestEntries();
            int rejected = Math.min(rejectPerBatch, entries.size());
            return PublishBatchResponse.builder()
                    .successful(entries.subList(rejected, entries.size()).stream()
                            .map(entry -> PublishBatchResultEntry.builder().id(entry.id()).messageId("m").build())
                            .toList())
                    .failed(entries.subList(0, rejected).stream()
                            .map(entry -> BatchResultErrorEntry.builder().id(entry.id()).code("Throttled")
                                    .message("slow down").senderFault(false).build())
                            .toList())
                    .build();
        }

        @Override
        public String serviceName() {
            return "sns";
        }

        @Override
        public void close() {}
    }
}
