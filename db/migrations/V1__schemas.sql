CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS eval;

CREATE TABLE core.dim_date (date_key date PRIMARY KEY, year smallint NOT NULL, month smallint NOT NULL, week smallint NOT NULL, day_of_week smallint NOT NULL, is_weekend boolean NOT NULL);
INSERT INTO core.dim_date (date_key, year, month, week, day_of_week, is_weekend)
SELECT d::date, EXTRACT(YEAR FROM d)::smallint, EXTRACT(MONTH FROM d)::smallint,
       EXTRACT(WEEK FROM d)::smallint, EXTRACT(ISODOW FROM d)::smallint,
       EXTRACT(ISODOW FROM d) IN (6, 7)
FROM generate_series('2023-01-01'::date, '2026-12-31'::date, '1 day') AS d;
CREATE TABLE core.dim_supplier (supplier_id text PRIMARY KEY, supplier_name text NOT NULL, region text NOT NULL, lead_time_mean numeric(8,2) NOT NULL, lead_time_sd numeric(8,2) NOT NULL CHECK (lead_time_mean > 0 AND lead_time_sd >= 0));
CREATE TABLE core.dim_product (sku text PRIMARY KEY, category text NOT NULL, product_name text NOT NULL, supplier_id text NOT NULL REFERENCES core.dim_supplier, case_pack int NOT NULL CHECK (case_pack > 0), unit_cost numeric(12,2) NOT NULL CHECK (unit_cost > 0), unit_price numeric(12,2) NOT NULL CHECK (unit_price > unit_cost));
CREATE TABLE core.dim_warehouse (warehouse_id text PRIMARY KEY, warehouse_name text NOT NULL, city text NOT NULL, latitude numeric(8,5) NOT NULL, longitude numeric(8,5) NOT NULL, climate_scale numeric(5,2) NOT NULL);

CREATE TABLE core.fact_sales_daily (feed_date date NOT NULL, sale_id text NOT NULL, sku text NOT NULL REFERENCES core.dim_product, warehouse_id text NOT NULL REFERENCES core.dim_warehouse, units_sold int NOT NULL CHECK (units_sold >= 0), unit_price numeric(12,2) NOT NULL, etl_run_id uuid NOT NULL, PRIMARY KEY (feed_date, sale_id)) PARTITION BY RANGE (feed_date);
CREATE TABLE core.fact_sales_daily_2023 PARTITION OF core.fact_sales_daily FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
CREATE TABLE core.fact_sales_daily_2024 PARTITION OF core.fact_sales_daily FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE core.fact_sales_daily_2025 PARTITION OF core.fact_sales_daily FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE core.fact_sales_daily_2026 PARTITION OF core.fact_sales_daily FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE core.fact_sales_daily_default PARTITION OF core.fact_sales_daily DEFAULT;
ALTER TABLE core.fact_sales_daily ADD CONSTRAINT fact_sales_daily_date_fk FOREIGN KEY (feed_date) REFERENCES core.dim_date(date_key);

CREATE TABLE core.fact_inventory_daily (feed_date date NOT NULL, inventory_id text NOT NULL, sku text NOT NULL REFERENCES core.dim_product, warehouse_id text NOT NULL REFERENCES core.dim_warehouse, on_hand int NOT NULL CHECK (on_hand >= 0), on_order int NOT NULL CHECK (on_order >= 0), reorder_point int NOT NULL CHECK (reorder_point >= 0), stockout_flag boolean NOT NULL, etl_run_id uuid NOT NULL, PRIMARY KEY (feed_date, inventory_id)) PARTITION BY RANGE (feed_date);
CREATE TABLE core.fact_inventory_daily_2023 PARTITION OF core.fact_inventory_daily FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
CREATE TABLE core.fact_inventory_daily_2024 PARTITION OF core.fact_inventory_daily FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE core.fact_inventory_daily_2025 PARTITION OF core.fact_inventory_daily FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE core.fact_inventory_daily_2026 PARTITION OF core.fact_inventory_daily FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE core.fact_inventory_daily_default PARTITION OF core.fact_inventory_daily DEFAULT;
ALTER TABLE core.fact_inventory_daily ADD CONSTRAINT fact_inventory_daily_date_fk FOREIGN KEY (feed_date) REFERENCES core.dim_date(date_key);

CREATE TABLE core.fact_po_event (event_id text PRIMARY KEY, po_id text NOT NULL, event_type text NOT NULL CHECK (event_type IN ('CREATED', 'ETA_UPDATED', 'CANCELLED', 'RECEIVED')), event_time timestamptz NOT NULL, supplier_id text REFERENCES core.dim_supplier, warehouse_id text REFERENCES core.dim_warehouse, sku text REFERENCES core.dim_product, quantity int CHECK (quantity >= 0), eta date REFERENCES core.dim_date(date_key), etl_run_id uuid NOT NULL);
CREATE TABLE core.fact_receipt (receipt_id text PRIMARY KEY, po_id text NOT NULL, receipt_date date NOT NULL REFERENCES core.dim_date(date_key), quantity int NOT NULL CHECK (quantity >= 0), warehouse_id text REFERENCES core.dim_warehouse, etl_run_id uuid NOT NULL);
CREATE OR REPLACE VIEW core.v_purchase_order AS
WITH latest AS (
    SELECT DISTINCT ON (po_id) *
    FROM core.fact_po_event
    ORDER BY po_id, (event_type = 'ETA_UPDATED') DESC, event_time DESC, event_id DESC
)
SELECT l.po_id, l.sku, l.supplier_id, l.warehouse_id, l.quantity,
       CASE WHEN EXISTS (SELECT 1 FROM core.fact_receipt r WHERE r.po_id = l.po_id)
            THEN 'RECEIVED' ELSE l.event_type END AS status,
       l.eta
FROM latest l;
