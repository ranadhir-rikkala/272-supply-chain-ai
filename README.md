# AI-Powered Supply Chain Optimization

CMPE 272, Fall 2026. Enterprise system that takes in daily ERP feeds, forecasts demand per product and warehouse, flags stockout and overstock risk, and routes reorder and transfer recommendations through role-based approval into purchase orders.

## Dashboard (dashboard/)

React 18 + TypeScript + Vite. Keycloak sign-in with PKCE, role-aware pages for overview, supply map with pending transfers, risks with forecast charts, approvals, orders, audit and admin. Served by Caddy over HTTPS with the API and Keycloak behind the same origin.

```bash
cd dashboard
npm ci
npm run dev:mock      # demo data, pick a demo user; no backend needed
npm run dev           # real mode: proxies /api to :8080 and /auth to :8180
npm run lint && npm test && npm run build
npm run e2e           # Playwright smoke tests (demo data); set E2E_BASE_URL and DEMO_USER_PASSWORD to run against a live stack
docker compose up -d caddy   # https://localhost
```

The mock API in `src/mocks` enforces the same approval rules as the platform API, and `src/api/types.ts` lists the exact response shapes the dashboard expects.

## Data platform (`pipeline/`)

The data platform produces deterministic ERP feeds and loads them through PostgreSQL. Start the dependencies with `cp .env.example .env && make up`, install the package with `make venv`, then run `make generate` and `make load`. `scgen` accepts `--start`, `--end`, and `--seed`; the default seed is 272 and gzip output uses a fixed timestamp for byte-identical reruns. `scetl load-master` validates manifests, schemas, types, dates, keys, and quality gates; rejected files and rows are retained under `data/quarantine/`. Set `DATABASE_URL` to load accepted catalog and fact rows into the Flyway-owned schema. `scetl worker` starts the RabbitMQ consumer with manual acknowledgements and bounded retry/DLQ handling.

The schema is available to Forecasting and the Platform API as soon as `flyway` completes. Contract tables include `core.dim_date`, product/supplier/warehouse dimensions, partitioned sales and inventory facts, purchase-order events/receipts, `ops.etl_*`, and `eval.v_quality_gate_check`.

Run `make test` for deterministic generator, defect-rate, feed-header, validation-line, checksum, quarantine, and rerun tests. Set `TEST_DATABASE_URL` and run `pytest -m integration` after `make up` to verify that every planted defect matches `eval.v_quality_gate_check` in PostgreSQL.
## Forecasting, CI and Monitoring
Owned by Teammate B (P3). One global XGBoost model with a Tweedie objective forecasts 28 days of daily demand for all 4,000 product and warehouse series, one week at a time. Every model is backtested on the last 184 days against a seasonal-naive baseline (the same weekday 364 days earlier). It must pass a quality gate before it can become ACTIVE: weekly WAPE below 25% and below the baseline. Results are in [ADR 0005](docs/adr/0005-demand-forecasting.md): weekly WAPE 14.9% against 22.5% for the baseline, better in every category and warehouse; daily WAPE 33.3% against 47.6%. The C4 context and container diagrams are in [docs/architecture](docs/architecture/README.md).

### Setup
Prerequisites: Docker Desktop, Python 3.12, and on macOS `brew install libomp` (XGBoost needs OpenMP). Then:
```bash
cp .env.example .env              # set FORECAST_SERVICE_TOKEN (16+ characters), FORECAST_DB_PASSWORD,
                                  # GRAFANA_ADMIN_PASSWORD and GRAFANA_DB_PASSWORD
make venv                         # installs the dev, forecast and service extras
make up                           # postgres, flyway, rabbitmq and the ETL workers
make generate && make load        # three years of ERP feeds into core.*
```

### Train a model and forecast
```bash
export DATABASE_URL=postgresql://supplychain:supplychain@localhost:5432/supplychain
scforecast train --requested-by you                       # train, backtest, gate, register; prints WAPE
scforecast activate <version> --reason "first release"    # only gate-passing models; an older version rolls back
scforecast predict --requested-by you                     # writes 112,000 rows to ml.forecast
```

### Run the API and worker
```bash
docker compose up -d --build forecast-api forecast-worker
set -a; source .env; set +a
curl -H "Authorization: Bearer $FORECAST_SERVICE_TOKEN" -H "Content-Type: application/json" \
     -d '{"requested_by":"you"}' http://127.0.0.1:8001/v1/forecast-runs      # 202 with a Location header
curl -H "Authorization: Bearer $FORECAST_SERVICE_TOKEN" http://127.0.0.1:8001/v1/models/active
```
`forecast-api` serves the internal API from the shared contract on `127.0.0.1:8001`:
- `/health/live`, `/health/ready`
- `/v1/models`, `/v1/models/active`, `/v1/models/{version}`, `POST /v1/models/{version}/activation`
- `POST /v1/training-runs`, `POST /v1/forecast-runs`, `GET /v1/forecast-runs/{id}`
- `/v1/series/{sku}/{warehouse_id}`
- `/metrics`, and OpenAPI docs at `/docs`

Every `/v1` call needs the service bearer token. Errors are `application/problem+json` with a `requestId`, and `X-Request-ID` is echoed back. `forecast-worker` consumes `forecast.jobs` on the `ml` exchange. Both services connect as the least-privilege role `forecast_service`. Model files are stored at `models/demand/<version>/model.ubj` and `metadata.json`.

### Open Grafana
```bash
docker compose up -d prometheus grafana
```
Open http://127.0.0.1:3000/grafana/ (or https://localhost/grafana/ behind Caddy) and sign in as `admin` with `GRAFANA_ADMIN_PASSWORD`. The **Supply chain operations** dashboard shows:
- API p95 latency and error rate
- the forecast circuit breaker
- queue depth and dead-letter depth
- ETL rows loaded vs quarantined per feed day
- model weekly WAPE vs the baseline

Prometheus is at http://127.0.0.1:9090. Demo check: `docker compose stop forecast-worker`, request a few forecast runs, and watch `forecast.jobs` rise with 0 consumers. Then `docker compose start forecast-worker` and watch it drain.

### Run the tests
```bash
ruff check . && ruff format --check .
pytest                                     # unit tests; integration tests skip without the variables below
TEST_DATABASE_URL=postgresql://supplychain:supplychain@localhost:5432/supplychain_test \
TEST_AMQP_URL=amqp://supplychain:supplychain@localhost:5672/ \
pytest                                     # also registry, runs, API (FastAPI TestClient) and worker against real services
```
The test database needs the migrations once: `docker compose run --rm -e FLYWAY_URL=jdbc:postgresql://postgres:5432/supplychain_test flyway`. The worker tests use their own exchange and queue, so they pass while `forecast-worker` is running. CI (`.github/workflows/ci.yml`) runs:
- ruff and the full pytest suite against Postgres and RabbitMQ
- Flyway migrate and validate on a clean database
- the platform API build and the dashboard lint, test and build
- a dependency scan
- Docker image builds with a Trivy scan, pushed to GHCR from `main`

### Additional features
- **Quality gate with rollback.** Only a model that passes the gate can be ACTIVE; Postgres enforces this with a check constraint and a single-ACTIVE index. Activating an older version rolls back, and every status change is recorded in `ml.model_status_history`.
- **Dead-letter queue.** Failed jobs retry after 1, 2 and 4 seconds, then go to `forecast.jobs.dlq`, and the forecast run is marked FAILED. Dead letters stay in the queue instead of looping back.
- **No-leakage backtest test.** Tests change every value after a forecast origin and assert the forecast does not change (`tests/test_forecast_model.py`, `tests/test_forecast_backtest.py`).
- **KEV and Trivy security scan.** CI fails when a Python dependency appears on the CISA Known Exploited Vulnerabilities list, on critical npm advisories, on committed secrets, and on critical image vulnerabilities that have a fix.
- **Grafana dashboards.** Prometheus and a read-only Postgres datasource, provisioned from files, with the dashboard served under `/grafana`.
- **Resilience.** If Postgres stops, the API answers 503 with `Retry-After` instead of 500, and recovers by itself when the database is back.

## Platform API and identity

The P4 service is Java 21 / Spring Boot 4 in `services/platform-api`. It is a stateless OAuth2 resource server; Keycloak imports the `supplychain` realm under `/auth`, with `VIEWER`, `PLANNER`, `SUPPLY_MANAGER` and `ADMIN` roles. The dashboard client uses PKCE S256 and tokens include the `platform-api` audience. Demo users and the confidential `smoke-test` client are provisioned from environment variables at Keycloak startup.

Set `API_DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `DEMO_USER_PASSWORD` (at least 12 characters with an uppercase letter and a digit), `SMOKE_CLIENT_SECRET`, and `FORECAST_SERVICE_TOKEN` in the local `.env`, then run:

```bash
docker compose up -d --build platform-api keycloak
curl -i https://localhost/api/v1/me
bash scripts/token.sh
```

The API is served behind Caddy at `/api/v1`; Keycloak is at `https://localhost/auth`. Direct local Keycloak access is bound to `127.0.0.1:8180`. OpenAPI documentation is available at `https://localhost/swagger-ui.html`; liveness/readiness and Prometheus metrics are at `/actuator/health` and `/actuator/prometheus` inside the compose network.

Implemented dashboard endpoints include `/me`, `/dashboard/summary`, `/warehouses`, `/risks`, `/series`, `/recommendations`, `/orders`, `/audit`, `/settings`, `/optimization-runs`, `/jobs`, `/quality`, `/models`, `/forecast-runs` and `/evaluation/risk-flags`. Reads require a valid dashboard token; audit is restricted to managers and admins, settings/model operations to admins, optimization/forecast runs to planners or admins, and recommendations to planners or supply managers. Admins cannot approve. Approval actions use ETags with `If-Match` and all POST requests require `Idempotency-Key`. The approval limit defaults to $10,000; larger planner approvals require a different supply manager to make the final decision. Every decision and setting change is recorded in the append-only audit log. See [ADR 0006](docs/adr/0006-platform-api-approval-and-audit.md) for the workflow and security decisions.

The Platform API's Flyway migrations begin at V20. They create the `app` schema and a least-privilege `platform_api` role; the database password is passed to Flyway as a placeholder. Keycloak runs against its own `keycloak-db` volume.

Run the API unit and PostgreSQL/Testcontainers integration tests from the repository root with Docker available:

```bash
docker run --rm \
  -v "$PWD":/workspace \
  -v "$HOME/.m2":/root/.m2 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -w /workspace/services/platform-api \
  maven:3.9.9-eclipse-temurin-21 mvn test
```

If Testcontainers cannot reach Docker, the integration tests can use an empty disposable PostgreSQL database by setting `PLATFORM_TEST_DATABASE_URL`, `PLATFORM_TEST_DATABASE_USERNAME` and `PLATFORM_TEST_DATABASE_PASSWORD`; the test suite applies the Flyway migrations to that database.
