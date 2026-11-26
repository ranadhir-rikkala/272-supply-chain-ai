package com.supplychain.platform.risk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class TransferPlannerTest {
    @Test
    void allocatesFromNearestEligibleWarehousesFirst() {
        List<TransferPlanner.Transfer> transfers = TransferPlanner.plan(
                "WH-EWR",
                40.7357,
                -74.1724,
                30,
                5,
                1.25,
                List.of(
                        new TransferPlanner.WarehouseSurplus("WH-CHI", 41.8781, -87.6298, 25),
                        new TransferPlanner.WarehouseSurplus("WH-ATL", 33.749, -84.388, 20),
                        new TransferPlanner.WarehouseSurplus("WH-BOS", 42.3601, -71.0589, 10)));

        assertEquals(2, transfers.size());
        assertEquals("WH-BOS", transfers.getFirst().sourceWarehouseId());
        assertEquals(10, transfers.getFirst().quantity());
        assertEquals(20, transfers.get(1).quantity());
    }

    @Test
    void requiresTruckTransitToBeatSupplierLeadTime() {
        List<TransferPlanner.Transfer> transfers = TransferPlanner.plan(
                "WH-EWR",
                40.7357,
                -74.1724,
                5,
                1.3,
                1.25,
                List.of(new TransferPlanner.WarehouseSurplus("WH-BOS", 42.3601, -71.0589, 10)));

        assertTrue(transfers.isEmpty());
    }

    @Test
    void computesZeroDistanceForSameCoordinates() {
        assertEquals(0, TransferPlanner.haversineMiles(40.0, -70.0, 40.0, -70.0));
    }

    @Test
    void comparesExactTransitTimeBeforeRoundingForDisplay() {
        List<TransferPlanner.Transfer> transfers = TransferPlanner.plan(
                "WH-A",
                0,
                0,
                5,
                1.6,
                1.25,
                List.of(new TransferPlanner.WarehouseSurplus("WH-B", 0, 4, 10)));

        assertEquals(1, transfers.size());
        assertEquals(2, transfers.getFirst().transitDays());
    }
}
