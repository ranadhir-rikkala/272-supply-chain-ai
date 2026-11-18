# ADR 0003: Purchase-order state comes from events

Purchase orders are reconstructed from the latest event per PO. A receipt takes precedence and exposes `RECEIVED`; this preserves ETA updates without overwriting event history.
