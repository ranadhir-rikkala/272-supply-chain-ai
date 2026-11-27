package com.supplychain.platform.alerts;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** Builds the SNS messages for a run: one readable summary and one JSON event per item. */
public final class RiskAlertMessages {
    public static final String SUMMARY_EVENT = "risk.high.summary";
    public static final String ITEM_EVENT = "risk.high";
    static final int SUMMARY_ITEMS = 15;

    private RiskAlertMessages() {}

    /** SNS subjects are limited to 100 ASCII characters. */
    public static String subject(RiskAlertsRaised event) {
        int count = event.alerts().size();
        return "Supply chain: " + count + " high-risk item" + (count == 1 ? "" : "s") + " as of " + event.asOfDate();
    }

    public static String summary(RiskAlertsRaised event, String publicUrl) {
        StringBuilder text = new StringBuilder();
        text.append("Optimization run ").append(event.runId())
                .append(" (as of ").append(event.asOfDate())
                .append(", model ").append(event.modelVersion())
                .append(", requested by ").append(event.requestedBy()).append(")\n")
                .append("flagged ").append(event.alerts().size()).append(" product and warehouse pairs as HIGH risk.\n\n");
        if (!event.alerts().isEmpty()) {
            int shown = Math.min(SUMMARY_ITEMS, event.alerts().size());
            text.append("Most urgent ").append(shown).append(":\n");
            for (RiskAlert alert : event.alerts().subList(0, shown)) {
                text.append("- ").append(alert.sku()).append(" at ").append(alert.warehouseId())
                        .append(" (").append(alert.productName()).append("): on hand ").append(alert.onHand())
                        .append(", ").append(cover(alert))
                        .append(", stockout ").append(alert.projectedStockoutDate() == null ? "not projected" : alert.projectedStockoutDate())
                        .append(", recommend ").append(alert.recommendedQuantity()).append(" units\n");
            }
            if (event.alerts().size() > shown) {
                text.append("...and ").append(event.alerts().size() - shown).append(" more.\n");
            }
        }
        text.append("\nReview and approve the recommendations: ").append(publicUrl).append("/approvals\n");
        return text.toString();
    }

    public static Map<String, Object> item(RiskAlertsRaised event, RiskAlert alert) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("event", ITEM_EVENT);
        body.put("run_id", event.runId().toString());
        body.put("as_of_date", event.asOfDate().toString());
        body.put("model_version", event.modelVersion());
        body.put("sku", alert.sku());
        body.put("warehouse_id", alert.warehouseId());
        body.put("product_name", alert.productName());
        body.put("category", alert.category());
        body.put("on_hand", alert.onHand());
        body.put("on_order", alert.onOrder());
        body.put("days_of_cover", alert.daysOfCover());
        body.put("projected_stockout_date",
                alert.projectedStockoutDate() == null ? null : alert.projectedStockoutDate().toString());
        body.put("recommended_quantity", alert.recommendedQuantity());
        return body;
    }

    private static String cover(RiskAlert alert) {
        return alert.daysOfCover() == null
                ? "no demand history"
                : String.format(Locale.ROOT, "%.1f days of cover", alert.daysOfCover());
    }
}
