CREATE INDEX IF NOT EXISTS fact_po_event_latest_by_po
    ON core.fact_po_event (po_id, (event_type = 'ETA_UPDATED') DESC, event_time DESC, event_id DESC)
    INCLUDE (event_type, sku, warehouse_id, quantity, eta);

CREATE INDEX IF NOT EXISTS fact_receipt_by_po
    ON core.fact_receipt (po_id);
