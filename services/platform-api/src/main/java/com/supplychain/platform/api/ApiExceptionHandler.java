package com.supplychain.platform.api;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private final HttpServletRequest request;

    public ApiExceptionHandler(HttpServletRequest request) {
        this.request = request;
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ProblemDetail> handleApiException(ApiException exception) {
        return problem(exception.status(), exception.title(), exception.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> handleValidation(MethodArgumentNotValidException exception) {
        Map<String, String> errors = exception.getBindingResult().getFieldErrors().stream()
                .collect(java.util.stream.Collectors.toMap(
                        FieldError::getField,
                        error -> error.getDefaultMessage() == null ? "invalid value" : error.getDefaultMessage(),
                        (first, ignored) -> first));
        ProblemDetail detail = createProblem(HttpStatus.BAD_REQUEST, "Validation Failed", "request validation failed");
        detail.setProperty("errors", errors);
        return ResponseEntity.badRequest().body(detail);
    }

    @ExceptionHandler(DataAccessResourceFailureException.class)
    ResponseEntity<ProblemDetail> handleDatabaseUnavailable(DataAccessResourceFailureException exception) {
        LOGGER.warn("Platform API database is unavailable", exception);
        ProblemDetail problem = createProblem(
                HttpStatus.SERVICE_UNAVAILABLE, "Database Unavailable", "the database is not reachable; retry shortly");
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header("Retry-After", "5")
                .body(problem);
    }

    @ExceptionHandler(com.supplychain.platform.service.ForecastClient.ForecastUnavailableException.class)
    ResponseEntity<ProblemDetail> handleForecastUnavailable(
            com.supplychain.platform.service.ForecastClient.ForecastUnavailableException exception) {
        LOGGER.warn("Forecast service is unavailable", exception);
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header("Retry-After", "30")
                .body(createProblem(HttpStatus.SERVICE_UNAVAILABLE, "Forecast Service Unavailable", exception.getMessage()));
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ProblemDetail> handleAccessDenied(AccessDeniedException exception) {
        return problem(HttpStatus.FORBIDDEN, "Forbidden", "you are not allowed to perform this action");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpected(Exception exception) {
        LOGGER.error("Unhandled platform API request failure", exception);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error", "the request could not be completed");
    }

    private ResponseEntity<ProblemDetail> problem(HttpStatus status, String title, String detail) {
        return ResponseEntity.status(status).body(createProblem(status, title, detail));
    }

    private ProblemDetail createProblem(HttpStatus status, String title, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(title);
        problem.setType(URI.create("https://supplychain.local/problems/" + title.toLowerCase().replace(' ', '-')));
        problem.setInstance(URI.create(request.getRequestURI()));
        Object requestId = request.getAttribute(RequestIdFilter.ATTRIBUTE);
        if (requestId != null) {
            problem.setProperty("requestId", requestId);
        }
        return problem;
    }
}
