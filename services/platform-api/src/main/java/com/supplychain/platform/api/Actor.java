package com.supplychain.platform.api;

import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

public record Actor(String username, List<String> roles) {
    public static Actor current() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken jwtAuthentication) {
            String username = jwtAuthentication.getToken().getClaimAsString("preferred_username");
            if (username == null || username.isBlank()) {
                username = jwtAuthentication.getName();
            }
            List<String> roles = jwtAuthentication.getAuthorities().stream()
                    .map(authority -> authority.getAuthority().replaceFirst("^ROLE_", ""))
                    .sorted()
                    .toList();
            return new Actor(username, roles);
        }
        String username = authentication == null ? "unknown" : authentication.getName();
        List<String> roles = authentication == null ? List.of() : authentication.getAuthorities().stream()
                .map(authority -> authority.getAuthority().replaceFirst("^ROLE_", ""))
                .sorted()
                .toList();
        return new Actor(username, roles);
    }

    public boolean hasRole(String role) {
        return roles.contains(role);
    }
}
