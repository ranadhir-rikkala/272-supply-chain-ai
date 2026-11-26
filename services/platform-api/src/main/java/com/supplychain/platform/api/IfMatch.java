package com.supplychain.platform.api;

import org.springframework.http.HttpStatus;

public final class IfMatch {
    private IfMatch() {}

    public static long requireVersion(String header) {
        if (header == null || header.isBlank()) {
            throw new ApiException(HttpStatus.PRECONDITION_REQUIRED, "Precondition Required", "If-Match is required");
        }
        String value = header.trim();
        if (value.startsWith("W/")) {
            value = value.substring(2);
        }
        if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) {
            value = value.substring(1, value.length() - 1);
        }
        try {
            long version = Long.parseLong(value);
            if (version < 1) {
                throw new NumberFormatException("version must be positive");
            }
            return version;
        } catch (NumberFormatException exception) {
            throw ApiException.badRequest("If-Match must contain a positive version");
        }
    }

    public static String etag(long version) {
        return "\"" + version + "\"";
    }
}
