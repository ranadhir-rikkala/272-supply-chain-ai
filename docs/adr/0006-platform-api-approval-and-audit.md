# ADR 0006: Platform API approval workflow and immutable audit trail

- Status: Accepted
- Owner: Teammate C (platform API)
- Date: 2026-11-26

## Context

The dashboard creates purchase and transfer decisions from forecast-backed risk
assessments. Planners may approve recommendations only up to the configured
planner limit; larger orders need a separate supply manager. Every transition
must be attributable and recoverable, and dashboard retries must not duplicate
orders.

## Decision

The Platform API is a stateless Spring Boot resource server. It validates JWT
signatures against Keycloak's internal JWKS endpoint, validates the public
issuer and requires the `platform-api` audience. Realm roles are mapped to
Spring method-security authorities. A request-id filter validates or generates
`X-Request-ID`, returns it to callers, and adds it to structured logs.

Recommendations are updated with optimistic versions. The dashboard reads an
ETag and must send its version in `If-Match`; missing versions receive 428 and
stale versions receive 412. POST requests require an `Idempotency-Key`. The
database stores a request hash and the completed response: identical retries
replay the response, a changed body returns 422, and an in-flight duplicate
returns 409.

An in-limit planner approval creates a draft order. An above-limit planner
action becomes an endorsement in `PENDING_MANAGER`; a supply manager other than
the endorser makes the final decision. Only supply managers can change order
quantities. Administrators manage settings and models but cannot approve.
Recommendation events record each transition, while `app.audit_log` stores
before and after snapshots. A database trigger rejects UPDATE, DELETE and
TRUNCATE on the audit table.

The API connects with a dedicated `platform_api` role. It can read the shared
data, forecast and evaluation schemas, write its own application schema, and
write evaluation results. The immutable audit table is excluded from update
and delete privileges. Keycloak uses its own PostgreSQL database and imports
the realm, public dashboard client, confidential smoke-test client, and roles
on first start. Demo user passwords and the smoke client secret are provisioned
from environment variables at startup, not stored in the repository.

The risk and transfer calculations are pure Java components. Optimization
persists one assessment per current SKU/warehouse and creates transfer
recommendations only when a nearby surplus warehouse can beat supplier lead
time. The forecast client has bounded timeouts and a Resilience4j circuit
breaker; a forecast outage returns historical series with
`forecastAvailable=false`.

## Consequences

- The approval limit and role checks are enforced at the service boundary and
  tested independently from the dashboard.
- ETags protect against stale decisions, and idempotency protects retries.
- The database trigger protects the audit history from application-level
  mutation, including accidental truncation.
- No production credentials are committed; local values come from `.env`.
- The existing data platform uses legacy column names for several dimension
  fields, so the API maps those names at its SQL boundary without changing the
  shared source tables.
