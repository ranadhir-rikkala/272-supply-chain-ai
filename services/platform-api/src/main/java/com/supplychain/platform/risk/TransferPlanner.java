package com.supplychain.platform.risk;

import java.util.Comparator;
import java.util.List;

public final class TransferPlanner {
    private static final double EARTH_RADIUS_MILES = 3958.7613;

    private TransferPlanner() {}

    public record WarehouseSurplus(String warehouseId, double latitude, double longitude, int surplus) {}
    public record Transfer(String sourceWarehouseId, int quantity, double distanceMiles, double freightCost, int transitDays) {}

    public static List<Transfer> plan(
            String targetWarehouseId,
            double targetLatitude,
            double targetLongitude,
            int requiredQuantity,
            double supplierLeadDays,
            double freightCostPerMile,
            List<WarehouseSurplus> warehouses) {
        if (requiredQuantity < 0 || supplierLeadDays < 0 || freightCostPerMile < 0) {
            throw new IllegalArgumentException("transfer planner values are outside supported ranges");
        }
        int[] remaining = {requiredQuantity};
        return warehouses.stream()
                .filter(source -> !source.warehouseId().equals(targetWarehouseId) && source.surplus() > 0)
                .map(source -> {
                    double miles = haversineMiles(targetLatitude, targetLongitude, source.latitude(), source.longitude());
                    double transitDays = 1 + miles / 500;
                    return new Candidate(source, miles, transitDays);
                })
                .filter(candidate -> candidate.transitDays() < supplierLeadDays)
                .sorted(Comparator.comparingDouble(Candidate::miles).thenComparing(candidate -> candidate.source().warehouseId()))
                .takeWhile(candidate -> remaining[0] > 0)
                .map(candidate -> {
                    int quantity = Math.min(remaining[0], candidate.source().surplus());
                    remaining[0] -= quantity;
                    double freight = Math.round(candidate.miles() * freightCostPerMile * 100.0) / 100.0;
                    return new Transfer(
                            candidate.source().warehouseId(),
                            quantity,
                            candidate.miles(),
                            freight,
                            (int) Math.ceil(candidate.transitDays()));
                })
                .toList();
    }

    public static double haversineMiles(double lat1, double lon1, double lat2, double lon2) {
        double latitudeDelta = Math.toRadians(lat2 - lat1);
        double longitudeDelta = Math.toRadians(lon2 - lon1);
        double a = Math.pow(Math.sin(latitudeDelta / 2), 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                        * Math.pow(Math.sin(longitudeDelta / 2), 2);
        return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private record Candidate(WarehouseSurplus source, double miles, double transitDays) {}
}
