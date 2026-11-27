-- Disruption evaluation looks up the purchase orders for one product and warehouse
-- many times per request; without this index each lookup scans every PO event.
CREATE INDEX IF NOT EXISTS fact_po_event_by_cell
    ON core.fact_po_event (sku, warehouse_id, event_time)
    INCLUDE (po_id);
