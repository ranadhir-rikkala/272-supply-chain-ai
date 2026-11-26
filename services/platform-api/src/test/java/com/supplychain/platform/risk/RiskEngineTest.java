package com.supplychain.platform.risk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

class RiskEngineTest {
    @Test
    void classifiesStockoutBeforeSupplierLeadTimeAsHigh() {
        RiskEngine.Assessment result = RiskEngine.assess(new RiskEngine.Input(
                LocalDate.parse("2025-12-01"),
                5,
                List.of(),
                Collections.nCopies(28, 2.0),
                2,
                0,
                5,
                0,
                6,
                null,
                7,
                90,
                1.65,
                7));

        assertEquals("HIGH", result.riskLevel());
        assertEquals(LocalDate.parse("2025-12-04"), result.projectedStockoutDate());
    }

    @Test
    void includesOpenPurchaseOrdersAndRoundsOrderQuantityToCasePack() {
        RiskEngine.Assessment result = RiskEngine.assess(new RiskEngine.Input(
                LocalDate.parse("2025-12-01"),
                8,
                List.of(new RiskEngine.Arrival(LocalDate.parse("2025-12-04"), 20)),
                Collections.nCopies(28, 2.0),
                2,
                1,
                3,
                0,
                6,
                14,
                2,
                90,
                1.65,
                7));

        assertEquals("LOW", result.riskLevel());
        assertEquals(0, result.recommendedQuantity() % 6);
        assertTrue(result.daysOfCover() <= 14);
    }

    @Test
    void usesMeanDemandAfterForecastHorizonWhenLeadTimeIsLonger() {
        RiskEngine.Assessment result = RiskEngine.assess(new RiskEngine.Input(
                LocalDate.parse("2025-12-01"),
                35,
                List.of(),
                Collections.nCopies(7, 1.0),
                1,
                0,
                40,
                0,
                1,
                null,
                7,
                90,
                1.65,
                7));

        assertEquals("HIGH", result.riskLevel());
        assertEquals(LocalDate.parse("2026-01-05"), result.projectedStockoutDate());
    }

    @Test
    void rejectsInvalidCasePack() {
        RiskEngine.Input input = new RiskEngine.Input(
                LocalDate.now(), 1, List.of(), List.of(), 1, 0, 1, 0, 0, null, 1, 30, 1.65, 1);
        assertThrows(IllegalArgumentException.class, () -> RiskEngine.assess(input));
    }
}
