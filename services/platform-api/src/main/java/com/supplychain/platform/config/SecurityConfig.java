package com.supplychain.platform.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.supplychain.platform.api.IdempotencyFilter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    @Bean
    ObjectMapper jackson2ObjectMapper() {
        return new ObjectMapper();
    }

    @Bean
    JwtDecoder jwtDecoder(
            @Value("${platform.security.jwk-set-uri}") String jwkSetUri,
            @Value("${platform.security.issuer-uri}") String issuerUri) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build();
        OAuth2TokenValidator<Jwt> issuerValidator = new JwtIssuerValidator(issuerUri);
        OAuth2TokenValidator<Jwt> audienceValidator = jwt -> jwt.getAudience().contains("platform-api")
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(
                        new OAuth2Error("invalid_token", "Required audience platform-api is missing", null));
        decoder.setJwtValidator(jwt -> {
            OAuth2TokenValidatorResult issuerResult = issuerValidator.validate(jwt);
            return issuerResult.hasErrors() ? issuerResult : audienceValidator.validate(jwt);
        });
        return decoder;
    }

    @Bean
    Converter<Jwt, AbstractAuthenticationToken> realmRoleConverter() {
        return jwt -> {
            Object realmAccess = jwt.getClaims().get("realm_access");
            if (!(realmAccess instanceof java.util.Map<?, ?> realm)
                    || !(realm.get("roles") instanceof Collection<?> roles)) {
                return new JwtAuthenticationToken(jwt, List.of());
            }
            List<GrantedAuthority> authorities = new ArrayList<>();
            for (Object role : roles) {
                if (role instanceof String name
                        && List.of("VIEWER", "PLANNER", "SUPPLY_MANAGER", "ADMIN").contains(name)) {
                    authorities.add(new SimpleGrantedAuthority("ROLE_" + name));
                }
            }
            String username = jwt.getClaimAsString("preferred_username");
            return new JwtAuthenticationToken(jwt, authorities, username == null ? jwt.getSubject() : username);
        };
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            Converter<Jwt, AbstractAuthenticationToken> realmRoleConverter,
            IdempotencyFilter idempotencyFilter,
            AuthenticationEntryPoint problemEntryPoint,
            AccessDeniedHandler problemDeniedHandler) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(request -> {
                    CorsConfiguration config = new CorsConfiguration();
                    config.setAllowedOrigins(List.of());
                    config.setAllowedMethods(List.of("GET", "POST", "PUT", "OPTIONS"));
                    config.setAllowedHeaders(List.of("Authorization", "Content-Type", "If-Match", "Idempotency-Key", "X-Request-ID"));
                    config.setExposedHeaders(List.of("ETag", "Location", "X-Request-ID"));
                    return config;
                }))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/actuator/health/**", "/actuator/prometheus", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html")
                        .permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(resource -> resource
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(realmRoleConverter))
                        .authenticationEntryPoint(problemEntryPoint))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint(problemEntryPoint)
                        .accessDeniedHandler(problemDeniedHandler))
                .headers(headers -> headers
                        .contentTypeOptions(Customizer.withDefaults())
                        .frameOptions(frame -> frame.deny())
                        .httpStrictTransportSecurity(hsts -> hsts.includeSubDomains(true).maxAgeInSeconds(31_536_000))
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                                        + "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
                                        + "base-uri 'self'; object-src 'none'"))
                        .referrerPolicy(referrer -> referrer.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                        .cacheControl(Customizer.withDefaults()));
        http.addFilterAfter(idempotencyFilter, AuthorizationFilter.class);
        return http.build();
    }

    @Bean
    FilterRegistrationBean<IdempotencyFilter> idempotencyServletRegistration(IdempotencyFilter filter) {
        FilterRegistrationBean<IdempotencyFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    AuthenticationEntryPoint problemEntryPoint() {
        return (request, response, exception) -> writeSecurityProblem(request, response, HttpStatus.UNAUTHORIZED, "Unauthorized");
    }

    @Bean
    AccessDeniedHandler problemDeniedHandler() {
        return (request, response, exception) -> writeSecurityProblem(request, response, HttpStatus.FORBIDDEN, "Forbidden");
    }

    private static void writeSecurityProblem(
            jakarta.servlet.http.HttpServletRequest request,
            jakarta.servlet.http.HttpServletResponse response,
            HttpStatus status,
            String title) throws java.io.IOException {
        response.setStatus(status.value());
        response.setContentType("application/problem+json");
        String requestId = String.valueOf(request.getAttribute(com.supplychain.platform.api.RequestIdFilter.ATTRIBUTE));
        response.getOutputStream().write(new ObjectMapper().writeValueAsBytes(java.util.Map.of(
                "type", "about:blank",
                "title", title,
                "status", status.value(),
                "detail", title.toLowerCase(),
                "instance", request.getRequestURI(),
                "requestId", requestId)));
    }
}
