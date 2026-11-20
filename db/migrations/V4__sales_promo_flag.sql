ALTER TABLE core.fact_sales_daily
    ADD COLUMN IF NOT EXISTS promo_flag boolean NOT NULL DEFAULT false;
