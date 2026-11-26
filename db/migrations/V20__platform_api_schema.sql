CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE app.setting (
    key text PRIMARY KEY,
    value numeric(14, 4) NOT NULL,
    min numeric(14, 4) NOT NULL,
    max numeric(14, 4) NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    description text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL DEFAULT 'system',
    CHECK (min <= max),
    CHECK (value BETWEEN min AND max)
);

INSERT INTO app.setting (key, value, min, max, description) VALUES
    ('planner_limit_usd', 10000, 100, 1000000, 'Maximum order value a planner can approve without manager approval'),
    ('safety_days', 7, 0, 60, 'Additional days of demand coverage used to classify medium risk'),
    ('overstock_days', 90, 14, 365, 'Coverage days above which inventory is overstocked'),
    ('freight_cost_per_mile', 1.25, 0, 100, 'Estimated freight cost per truck mile')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE app.optimization_run (
    run_id uuid PRIMARY KEY,
    as_of_date date NOT NULL,
    model_version text NOT NULL,
    status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
    requested_by text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NOT NULL DEFAULT now(),
    result jsonb NOT NULL DEFAULT '{}'::jsonb,
    error text
);
CREATE INDEX optimization_run_latest ON app.optimization_run (finished_at DESC);

CREATE TABLE app.risk_assessment (
    run_id uuid NOT NULL REFERENCES app.optimization_run ON DELETE CASCADE,
    sku text NOT NULL,
    warehouse_id text NOT NULL,
    as_of_date date NOT NULL,
    on_hand integer NOT NULL CHECK (on_hand >= 0),
    on_order integer NOT NULL CHECK (on_order >= 0),
    mean_daily_demand double precision NOT NULL CHECK (mean_daily_demand >= 0),
    sd_daily_demand double precision NOT NULL CHECK (sd_daily_demand >= 0),
    lead_time_days double precision NOT NULL CHECK (lead_time_days >= 0),
    days_of_cover double precision,
    projected_stockout_date date,
    risk_level text NOT NULL CHECK (risk_level IN ('HIGH', 'MEDIUM', 'LOW')),
    overstocked boolean NOT NULL,
    safety_stock integer NOT NULL CHECK (safety_stock >= 0),
    reorder_point integer NOT NULL CHECK (reorder_point >= 0),
    PRIMARY KEY (run_id, sku, warehouse_id)
);
CREATE INDEX risk_assessment_latest ON app.risk_assessment (as_of_date DESC, risk_level);

CREATE TABLE app.recommendation (
    recommendation_id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES app.optimization_run,
    kind text NOT NULL CHECK (kind IN ('REORDER', 'TRANSFER')),
    sku text NOT NULL,
    warehouse_id text NOT NULL,
    source_warehouse_id text,
    supplier_id text,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_cost numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
    freight_cost numeric(12, 2),
    distance_miles numeric(12, 2),
    lead_days integer NOT NULL CHECK (lead_days >= 0),
    expected_arrival date NOT NULL,
    risk_level text NOT NULL CHECK (risk_level IN ('HIGH', 'MEDIUM')),
    reason text NOT NULL,
    status text NOT NULL CHECK (status IN ('PENDING_REVIEW', 'PENDING_MANAGER', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
    endorsed_by text,
    decided_by text,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recommendation_inbox ON app.recommendation (status, risk_level, created_at);
CREATE INDEX recommendation_warehouse ON app.recommendation (warehouse_id, status);

CREATE TABLE app.recommendation_event (
    event_id bigserial PRIMARY KEY,
    recommendation_id uuid NOT NULL REFERENCES app.recommendation,
    from_status text,
    to_status text NOT NULL,
    actor text NOT NULL,
    actor_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
    comment text,
    quantity_before integer,
    quantity_after integer,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recommendation_event_history ON app.recommendation_event (recommendation_id, event_id);

CREATE SEQUENCE app.purchase_order_number START WITH 1;
CREATE SEQUENCE app.transfer_order_number START WITH 1;
CREATE TABLE app.draft_order (
    order_id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('PURCHASE', 'TRANSFER')),
    recommendation_id uuid NOT NULL UNIQUE REFERENCES app.recommendation,
    sku text NOT NULL,
    warehouse_id text NOT NULL,
    source_warehouse_id text,
    supplier_id text,
    quantity integer NOT NULL CHECK (quantity > 0),
    total_value numeric(14, 2) NOT NULL CHECK (total_value >= 0),
    freight_cost numeric(12, 2),
    expected_arrival date NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX draft_order_created ON app.draft_order (created_at DESC);

CREATE TABLE app.audit_log (
    audit_id bigserial PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor text NOT NULL,
    actor_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    "before" jsonb,
    "after" jsonb,
    request_id text
);
CREATE INDEX audit_log_timeline ON app.audit_log (occurred_at DESC, audit_id DESC);

CREATE FUNCTION app.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'app.audit_log is append-only';
END;
$$;
CREATE TRIGGER audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON app.audit_log
    FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();
CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON app.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION app.reject_audit_mutation();

CREATE TABLE app.idempotency_record (
    actor text NOT NULL,
    idempotency_key text NOT NULL,
    route text NOT NULL,
    request_hash text NOT NULL,
    state text NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
    response_status integer,
    response_body bytea,
    response_content_type text,
    response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    PRIMARY KEY (actor, idempotency_key, route)
);
CREATE INDEX idempotency_record_age ON app.idempotency_record (created_at);

CREATE TABLE eval.risk_flag_result (
    evaluation_id uuid NOT NULL,
    disruption_id text NOT NULL REFERENCES eval.disruption_truth,
    kind text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    description text NOT NULL,
    impacted_cells integer NOT NULL DEFAULT 0,
    flagged_seven_days_ahead integer NOT NULL DEFAULT 0,
    without_stockouts integer NOT NULL DEFAULT 0,
    median_lead_days double precision,
    caught boolean NOT NULL DEFAULT false,
    evaluated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (evaluation_id, disruption_id)
);
CREATE INDEX risk_flag_result_latest ON eval.risk_flag_result (evaluated_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_api') THEN
        CREATE ROLE platform_api LOGIN;
    END IF;
END
$$;
ALTER ROLE platform_api WITH LOGIN PASSWORD '${api_db_password}';
GRANT CONNECT ON DATABASE ${flyway:database} TO platform_api;
GRANT USAGE ON SCHEMA app, core, ops, ml, eval TO platform_api;
GRANT SELECT ON ALL TABLES IN SCHEMA core, ops, ml, eval TO platform_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO platform_api;
REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_log FROM platform_api;
GRANT INSERT, UPDATE ON eval.risk_flag_result TO platform_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO platform_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA eval TO platform_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO platform_api;
