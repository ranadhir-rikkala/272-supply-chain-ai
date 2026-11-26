package com.supplychain.platform.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

@Component
public class IdempotencyFilter extends OncePerRequestFilter {
    private static final int MAX_REQUEST_BYTES = 1_048_576;
    private static final String[] REPLAY_HEADERS = {"ETag", "Location"};

    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    public IdempotencyFilter(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equalsIgnoreCase(request.getMethod())
                || !request.getRequestURI().startsWith("/api/v1/");
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String key = request.getHeader("Idempotency-Key");
        if (key == null || !key.matches("[A-Za-z0-9._:-]{8,128}")) {
            writeProblem(response, request, 400, "Bad Request", "a valid Idempotency-Key is required");
            return;
        }
        byte[] body = request.getInputStream().readNBytes(MAX_REQUEST_BYTES + 1);
        if (body.length > MAX_REQUEST_BYTES) {
            writeProblem(response, request, 413, "Content Too Large", "request body exceeds 1 MiB");
            return;
        }
        String actor = currentActor();
        String route = request.getRequestURI();
        String hash = sha256(body);
        int inserted = jdbc.sql("""
                INSERT INTO app.idempotency_record (actor, idempotency_key, route, request_hash, state)
                VALUES (:actor, :key, :route, :hash, 'IN_PROGRESS')
                ON CONFLICT (actor, idempotency_key, route) DO NOTHING
                """)
                .param("actor", actor)
                .param("key", key)
                .param("route", route)
                .param("hash", hash)
                .update();
        if (inserted == 0) {
            replayOrReject(response, request, actor, key, route, hash);
            return;
        }
        ContentCachingResponseWrapper cachedResponse = new ContentCachingResponseWrapper(response);
        try {
            chain.doFilter(new RepeatableBodyRequest(request, body), cachedResponse);
            Map<String, String> headers = new LinkedHashMap<>();
            for (String name : REPLAY_HEADERS) {
                String value = cachedResponse.getHeader(name);
                if (value != null) {
                    headers.put(name, value);
                }
            }
            jdbc.sql("""
                    UPDATE app.idempotency_record
                    SET state = 'COMPLETED', response_status = :status, response_body = :body,
                        response_content_type = :contentType,
                        response_headers = CAST(:headers AS jsonb), completed_at = now()
                    WHERE actor = :actor AND idempotency_key = :key AND route = :route
                    """)
                    .param("status", cachedResponse.getStatus())
                    .param("body", cachedResponse.getContentAsByteArray())
                    .param("contentType", cachedResponse.getContentType())
                    .param("headers", objectMapper.writeValueAsString(headers))
                    .param("actor", actor)
                    .param("key", key)
                    .param("route", route)
                    .update();
        } finally {
            cachedResponse.copyBodyToResponse();
        }
    }

    private void replayOrReject(
            HttpServletResponse response,
            HttpServletRequest request,
            String actor,
            String key,
            String route,
            String requestHash) throws IOException {
        var stored = jdbc.sql("""
                SELECT request_hash, state, response_status, response_body, response_content_type,
                       response_headers::text AS response_headers
                FROM app.idempotency_record
                WHERE actor = :actor AND idempotency_key = :key AND route = :route
                """)
                .param("actor", actor)
                .param("key", key)
                .param("route", route)
                .query((rs, row) -> new StoredResponse(
                        rs.getString("request_hash"),
                        rs.getString("state"),
                        rs.getObject("response_status", Integer.class),
                        rs.getBytes("response_body"),
                        rs.getString("response_content_type"),
                        rs.getString("response_headers")))
                .optional();
        if (stored.isEmpty()) {
            writeProblem(response, request, 409, "Conflict", "the request is still being processed");
            return;
        }
        StoredResponse replay = stored.get();
        if (!replay.requestHash().equals(requestHash)) {
            writeProblem(response, request, 422, "Unprocessable Content", "this idempotency key was already used with a different request body");
            return;
        }
        if (!"COMPLETED".equals(replay.state())) {
            writeProblem(response, request, 409, "Conflict", "the request is still being processed");
            return;
        }
        response.setStatus(replay.status());
        if (replay.contentType() != null) {
            response.setContentType(replay.contentType());
        }
        Map<?, ?> headers = objectMapper.readValue(replay.headers(), Map.class);
        headers.forEach((name, value) -> response.setHeader(String.valueOf(name), String.valueOf(value)));
        if (replay.body() != null) {
            response.getOutputStream().write(replay.body());
        }
    }

    private String currentActor() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken jwt) {
            String username = jwt.getToken().getClaimAsString("preferred_username");
            return username == null ? jwt.getName() : username;
        }
        return authentication == null ? "unknown" : authentication.getName();
    }

    private String sha256(byte[] body) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required by the Java runtime", exception);
        }
    }

    private void writeProblem(
            HttpServletResponse response,
            HttpServletRequest request,
            int status,
            String title,
            String detail) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        String requestId = String.valueOf(request.getAttribute(RequestIdFilter.ATTRIBUTE));
        response.getOutputStream().write(objectMapper.writeValueAsBytes(Map.of(
                "type", "about:blank",
                "title", title,
                "status", status,
                "detail", detail,
                "instance", request.getRequestURI(),
                "requestId", requestId)));
    }

    private record StoredResponse(
            String requestHash,
            String state,
            Integer status,
            byte[] body,
            String contentType,
            String headers) {}

    private static final class RepeatableBodyRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        private RepeatableBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream input = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override
                public int read() {
                    return input.read();
                }

                @Override
                public boolean isFinished() {
                    return input.available() == 0;
                }

                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setReadListener(ReadListener listener) {
                    throw new UnsupportedOperationException("asynchronous request bodies are not supported");
                }
            };
        }

        @Override
        public java.io.BufferedReader getReader() {
            return new java.io.BufferedReader(
                    new java.io.InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
        }
    }
}
