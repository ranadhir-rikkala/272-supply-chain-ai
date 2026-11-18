CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS eval;

CREATE TABLE core.dim_date (date_key date PRIMARY KEY, year smallint NOT NULL, month smallint NOT NULL, week smallint NOT NULL, day_of_week smallint NOT NULL, is_weekend boolean NOT NULL);
CREATE TABLE core.dim_product (sku text PRIMARY KEY, category text NOT NULL, product_name text NOT NULL, unit_price numeric(12,2) NOT NULL CHECK (unit_price > 0));
CREATE TABLE core.dim_supplier (supplier_id text PRIMARY KEY, supplier_name text NOT NULL, region text NOT NULL, lead_time_min int NOT NULL, lead_time_max int NOT NULL, CHECK (lead_time_min > 0 AND lead_time_max >= lead_time_min));
CREATE TABLE core.dim_warehouse (warehouse_id text PRIMARY KEY, warehouse_name text NOT NULL, city text NOT NULL, latitude numeric(8,5) NOT NULL, longitude numeric(8,5) NOT NULL, climate_scale numeric(5,2) NOT NULL);

CREATE TABLE core.fact_sales (feed_date date NOT NULL, sale_id text NOT NULL, sku text NOT NULL REFERENCES core.dim_product, warehouse_id text NOT NULL REFERENCES core.dim_warehouse, units_sold int NOT NULL CHECK (units_sold >= 0), unit_price numeric(12,2) NOT NULL, etl_run_id uuid NOT NULL, PRIMARY KEY (feed_date, sale_id)) PARTITION BY RANGE (feed_date);
CREATE TABLE core.fact_sales_2023 PARTITION OF core.fact_sales FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
CREATE TABLE core.fact_sales_2024 PARTITION OF core.fact_sales FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE core.fact_sales_2025 PARTITION OF core.fact_sales FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE core.fact_sales_2026 PARTITION OF core.fact_sales FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE core.fact_sales_default PARTITION OF core.fact_sales DEFAULT;

CREATE TABLE core.fact_inventory (feed_date date NOT NULL, inventory_id text NOT NULL, sku text NOT NULL REFERENCES core.dim_product, warehouse_id text NOT NULL REFERENCES core.dim_warehouse, on_hand int NOT NULL CHECK (on_hand >= 0), reorder_point int NOT NULL CHECK (reorder_point >= 0), etl_run_id uuid NOT NULL, PRIMARY KEY (feed_date, inventory_id)) PARTITION BY RANGE (feed_date);
CREATE TABLE core.fact_inventory_2023 PARTITION OF core.fact_inventory FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');
CREATE TABLE core.fact_inventory_2024 PARTITION OF core.fact_inventory FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE core.fact_inventory_2025 PARTITION OF core.fact_inventory FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE core.fact_inventory_2026 PARTITION OF core.fact_inventory FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE core.fact_inventory_default PARTITION OF core.fact_inventory DEFAULT;

CREATE TABLE core.fact_po_event (event_id text PRIMARY KEY, po_id text NOT NULL, event_type text NOT NULL, event_time timestamptz NOT NULL, supplier_id text REFERENCES core.dim_supplier, warehouse_id text REFERENCES core.dim_warehouse, sku text REFERENCES core.dim_product, quantity int CHECK (quantity >= 0), eta date, etl_run_id uuid NOT NULL);
CREATE TABLE core.fact_receipt (receipt_id text PRIMARY KEY, po_id text NOT NULL, receipt_date date NOT NULL, quantity int NOT NULL CHECK (quantity >= 0), warehouse_id text REFERENCES core.dim_warehouse, etl_run_id uuid NOT NULL);
CREATE OR REPLACE VIEW core.v_purchase_order AS
WITH latest AS (SELECT DISTINCT ON (po_id) * FROM core.fact_po_event ORDER BY po_id, event_time DESC)
SELECT l.po_id, l.sku, l.supplier_id, l.warehouse_id, l.quantity, CASE WHEN EXISTS (SELECT 1 FROM core.fact_receipt r WHERE r.po_id=l.po_id) THEN 'RECEIVED' ELSE l.event_type END AS status, l.eta FROM latest l;
