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
