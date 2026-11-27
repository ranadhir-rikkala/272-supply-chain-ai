package com.supplychain.platform.alerts;

import java.time.LocalDate;

/** One product and warehouse that an optimization run rated HIGH risk. */
public record RiskAlert(
        String sku,
        String warehouseId,
        String productName,
        String category,
        int onHand,
        int onOrder,
        Double daysOfCover,
        LocalDate projectedStockoutDate,
        int recommendedQuantity) {}
