package com.supplychain.platform.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.supplychain.platform.risk.RiskEngine;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class EvaluationServiceTest {
    private static final LocalDate ACTUAL_STOCKOUT = LocalDate.of(2025, 3, 20);

    private static RiskEngine.Assessment assessment(String risk, LocalDate projectedStockout) {
        return new RiskEngine.Assessment(risk, 0, 0, 0, null, projectedStockout, false);
    }

    @Test
    void warnsWhenProjectedStockoutIsOnOrBeforeTheActualOne() {
        assertTrue(EvaluationService.warnsBefore(assessment("HIGH", ACTUAL_STOCKOUT), ACTUAL_STOCKOUT));
        assertTrue(EvaluationService.warnsBefore(assessment("MEDIUM", ACTUAL_STOCKOUT.minusDays(2)), ACTUAL_STOCKOUT));
    }

    @Test
    void doesNotRequireTheProjectionToBeAWeekTooEarly() {
        // Projected three days before the real stockout: an accurate warning, not a miss.
        assertTrue(EvaluationService.warnsBefore(assessment("HIGH", ACTUAL_STOCKOUT.minusDays(3)), ACTUAL_STOCKOUT));
    }

    @Test
    void ignoresLowRiskLateOrMissingProjections() {
        assertFalse(EvaluationService.warnsBefore(assessment("LOW", ACTUAL_STOCKOUT), ACTUAL_STOCKOUT));
        assertFalse(EvaluationService.warnsBefore(assessment("HIGH", ACTUAL_STOCKOUT.plusDays(1)), ACTUAL_STOCKOUT));
        assertFalse(EvaluationService.warnsBefore(assessment("HIGH", null), ACTUAL_STOCKOUT));
    }
}
