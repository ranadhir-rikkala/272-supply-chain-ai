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
