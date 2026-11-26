package com.supplychain.platform.risk;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;

public final class RiskEngine {
    private RiskEngine() {}

    public record Arrival(LocalDate date, int quantity) {}

    public record Input(
            LocalDate asOfDate,
            int onHand,
            List<Arrival> openOrders,
            List<Double> forecastDemand,
            double meanDailyDemand,
            double sdDailyDemand,
            double leadTimeDays,
            double leadTimeSdDays,
            int casePack,
            Integer shelfLifeDays,
            int safetyDays,
            int overstockDays,
            double serviceLevelZ,
            int reviewDays) {}

    public record Assessment(
            String riskLevel,
            int safetyStock,
            int reorderPoint,
            int recommendedQuantity,
            Double daysOfCover,
            LocalDate projectedStockoutDate,
            boolean overstocked) {}

    public static Assessment assess(Input input) {
        if (input.onHand() < 0 || input.meanDailyDemand() < 0 || input.sdDailyDemand() < 0
                || input.leadTimeDays() < 0 || input.leadTimeSdDays() < 0 || input.casePack() <= 0
                || input.safetyDays() < 0 || input.overstockDays() <= 0 || input.reviewDays() < 0) {
            throw new IllegalArgumentException("risk input values are outside supported ranges");
        }
        double mean = input.meanDailyDemand();
        double lead = input.leadTimeDays();
        double safety = input.serviceLevelZ()
                * Math.sqrt(lead * Math.pow(input.sdDailyDemand(), 2)
                        + Math.pow(mean, 2) * Math.pow(input.leadTimeSdDays(), 2));
        int safetyStock = (int) Math.ceil(safety);
        int reorderPoint = (int) Math.ceil(mean * lead + safety);
        int horizon = Math.max(
                Math.max(1, input.forecastDemand().size()),
                (int) Math.ceil(input.leadTimeDays()) + input.safetyDays() + 1);
        LocalDate stockout = null;
        double projected = input.onHand();
        for (int day = 0; day < horizon; day++) {
            LocalDate date = input.asOfDate().plusDays(day + 1L);
            for (Arrival arrival : input.openOrders()) {
                LocalDate arrivalDate = arrival.date().isBefore(input.asOfDate().plusDays(1))
                        ? input.asOfDate().plusDays(1)
                        : arrival.date();
                if (arrivalDate.equals(date)) {
                    projected += arrival.quantity();
                }
            }
            double demand = day < input.forecastDemand().size() ? input.forecastDemand().get(day) : mean;
            projected -= Math.max(0, demand);
            if (stockout == null && projected <= 0) {
                stockout = date;
            }
        }
        int daysToStockout = stockout == null
                ? Integer.MAX_VALUE
                : Math.toIntExact(java.time.temporal.ChronoUnit.DAYS.between(input.asOfDate(), stockout));
        String risk = daysToStockout <= Math.ceil(lead)
                ? "HIGH"
                : daysToStockout <= Math.ceil(lead) + input.safetyDays() ? "MEDIUM" : "LOW";
        double supply = input.onHand() + input.openOrders().stream()
                .filter(order -> !order.date().isAfter(input.asOfDate().plusDays(input.safetyDays() + (long) Math.ceil(lead))))
                .mapToInt(Arrival::quantity)
                .sum();
        Double cover = mean == 0 ? null : supply / mean;
        if (cover != null && input.shelfLifeDays() != null) {
            cover = Math.min(cover, input.shelfLifeDays());
        }
        boolean overstocked = cover != null && cover > input.overstockDays();
        int targetDays = Math.max(1, (int) Math.ceil(lead) + input.reviewDays());
        double targetDemand = 0;
        for (int day = 0; day < targetDays; day++) {
            targetDemand += day < input.forecastDemand().size()
                    ? Math.max(0, input.forecastDemand().get(day))
                    : mean;
        }
        int expectedIncoming = input.openOrders().stream()
                .filter(order -> !order.date().isAfter(input.asOfDate().plusDays(targetDays)))
                .mapToInt(Arrival::quantity)
                .sum();
        int needed = Math.max(0, (int) Math.ceil(targetDemand + safetyStock - input.onHand() - expectedIncoming));
        int orderQuantity = needed == 0 ? 0 : (int) Math.ceil(needed / (double) input.casePack()) * input.casePack();
        return new Assessment(risk, safetyStock, reorderPoint, orderQuantity, cover, stockout, overstocked);
    }
}
