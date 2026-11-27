# Demo script

A 7 to 8 minute walkthrough of the full flow: data in, forecast, risk, recommendation, approval, purchase order, audit and monitoring. Every step was run end to end on 2026-11-26, and the numbers below come from that run.

`DEMO_URL` is `https://localhost` for the local stack, or the CloudFront URL when the AWS stack is up.

## Before the demo (30 minutes ahead)

1. Start the stack and wait until every service is healthy:
   - Local: `docker compose up -d --build`, then `docker compose ps`.
   - AWS: see [infra/aws/README.md](../infra/aws/README.md).
2. Make sure the data is loaded and a model is active. Overview should show about 9.7M rows loaded and an active model.
3. Run one optimization as `pat.planner` so the inbox is full (about 2,400 recommendations).
4. Open these tabs in one browser window:
   - `DEMO_URL` (dashboard, signed out)
   - `DEMO_URL/grafana/` (signed in as `admin`)
   - `DEMO_URL/swagger-ui.html`
5. Use a private window for the second user, so the two sessions don't share cookies.
6. All four demo users share `DEMO_USER_PASSWORD` from `.env` (or Secrets Manager on AWS).

| User | Role | What they can do |
|---|---|---|
| `vic.viewer` | Viewer | Read only |
| `pat.planner` | Planner | Run optimization, approve up to $10,000 |
| `max.manager` | Supply manager | Final approval above $10,000, audit log |
| `ada.admin` | Admin | Models, settings, evaluation; cannot approve |

## The walkthrough

### 1. The problem (30 s)

> A retailer with 500 products in 8 warehouses gets daily ERP feeds. Planners need to know where stock will run out or pile up, and what to do about it, with controls on who can spend money.

### 2. Data platform (1 min) — signed in as `pat.planner`, Overview page

- **Show:** rows loaded (9,693,632) and rows quarantined (87,602).
- **Say:** the generator plants 87,602 known defects in three years of feeds. The ETL quarantined all 87,602 with the expected reason and missed none, checked by `eval.v_quality_gate_check`.
- **Say:** loads are idempotent. Re-running a day doesn't duplicate rows, and bad files go to quarantine instead of stopping the pipeline.

### 3. Forecasting (1 min) — Overview, model card

- **Show:** the active model and its weekly WAPE of 14.9%, against 22.5% for the seasonal-naive baseline.
- **Say:** one global XGBoost model covers all 4,000 product-warehouse series. A model can only go live if it beats the baseline and stays under 25% error; Postgres enforces this, and rolling back means activating an older version.
- **Say:** a forecast run goes through RabbitMQ to a worker and writes 112,000 forecast rows in about 20 seconds.

### 4. Risk and recommendations (1.5 min) — Risks, then Supply map

- **Show:** Risks filtered to one warehouse. Open one high-risk item to show the forecast chart and projected stockout date.
- **Show:** Supply map with pending transfers between warehouses.
- **Say:** the optimizer checked 3,960 cells and found 617 high and 1,047 medium risks. It suggests a transfer when a nearby warehouse has surplus and can deliver faster than the supplier; otherwise it suggests a reorder. Here that came to 2,315 transfers and 72 reorders.

### 5. Approval workflow (2 min) — Approvals

1. As `pat.planner`, approve an order **under $10,000** with a comment. The toast says a draft order was created (`DPO-…` or `DTO-…`).
2. Still as the planner, open an order **over $10,000**. The button says **Endorse for manager**, not Approve. Endorse it.
3. In the private window, sign in as `max.manager`, open **Needs manager**, and approve it.
4. Open **Orders**: both draft orders are there.

- **Say:** the limit is enforced by the API, not just the UI. The person who endorses an order can't also give it final approval, and admins can't approve at all.
- **Say:** every approval needs the record's current version (`If-Match`), so two people can't approve over each other's changes, and every POST needs an `Idempotency-Key`, so a double-click doesn't create two orders.

### 6. Audit and security (45 s) — Audit, as `max.manager`

- **Show:** the audit entries for the approvals you just made.
- **Say:** the audit log is append-only. The API's own database role is denied UPDATE and DELETE on it.
- **Show (optional):** sign in as `vic.viewer` and open `/admin`: "Not available for your role".

### 7. Monitoring (1 min) — Grafana tab

- **Show:** API latency and error rate, the forecast circuit breaker, queue depth, ETL loaded against quarantined, and model WAPE against the baseline.
- **Optional live moment:** stop the forecast worker, request two forecast runs, and watch `forecast.jobs` rise with 0 consumers; start it again and watch the queue drain.
  - Local: `docker compose stop forecast-worker` and `docker compose start forecast-worker`.
  - AWS: set the `forecast-worker` service's desired count to 0, then back to 1.

### 8. Close (30 s)

> CI runs lint, unit and integration tests, migration checks and security scans (including the CISA Known Exploited Vulnerabilities list and Trivy image scans) on every pull request. The whole system runs from one Compose file locally, or from Terraform on AWS.

## If something goes wrong

| Problem | What to do |
|---|---|
| Sign-in loops or fails | Use a fresh private window. On AWS, check that the Keycloak service is healthy. |
| Approvals inbox is empty | Run an optimization as `pat.planner` (Overview, or `POST /api/v1/optimization-runs`). |
| AWS stack is down | Switch to the local stack at `https://localhost`. It runs the same code with the same data. |
| A page shows an error | Refresh once, then show the same step in Swagger. |

**Don't run the disruption evaluation live.** It takes about 80 seconds and, on AWS, runs past CloudFront's 60-second limit. Show its last result on the Admin page instead.

## Likely questions

- **Why one global model instead of one per product?** It shares patterns across categories and handles short histories; 4,000 separate models would be weaker and slower (ADR 0005).
- **How do you know the ETL is correct?** The generator writes an answer key of every planted defect, and the quality-gate view joins against it (ADR 0001).
- **What stops a planner from approving a $50k order?** The API checks the limit and the role on every approval, and the second approver must be a different person (ADR 0006).
- **What would you do next?** Use the ML forecast in the disruption evaluation (today it catches supply-side disruptions but not demand spikes), make the evaluation a background job, and move RabbitMQ to Amazon MQ.
