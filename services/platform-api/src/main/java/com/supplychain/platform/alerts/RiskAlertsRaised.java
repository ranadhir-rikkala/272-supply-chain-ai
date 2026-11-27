package com.supplychain.platform.alerts;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Raised inside an optimization run; {@link RiskAlertPublisher} sends it once the run's
 * transaction commits, so a rolled-back run never produces alerts.
 */
public record RiskAlertsRaised(
        UUID runId, LocalDate asOfDate, String modelVersion, String requestedBy, List<RiskAlert> alerts) {

    /** Most urgent first: earliest projected stockout, then fewest days of cover. */
    public static final Comparator<RiskAlert> URGENCY = Comparator
            .comparing(RiskAlert::projectedStockoutDate, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(RiskAlert::daysOfCover, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(RiskAlert::sku)
            .thenComparing(RiskAlert::warehouseId);

    public RiskAlertsRaised {
        alerts = alerts.stream().sorted(URGENCY).toList();
    }
}
