from __future__ import annotations

from datetime import date

SPECS = {
    "sales": (
        ["feed_date", "sale_id", "sku", "warehouse_id", "units_sold", "unit_price"],
        {"units_sold": int, "unit_price": float},
    ),
    "inventory": (
        ["feed_date", "inventory_id", "sku", "warehouse_id", "on_hand", "reorder_point"],
        {"on_hand": int, "reorder_point": int},
    ),
    "po_events": (
        [
            "event_id",
            "po_id",
            "event_type",
            "event_time",
            "supplier_id",
            "warehouse_id",
            "sku",
            "quantity",
            "eta",
        ],
        {"quantity": int},
    ),
    "receipts": (
        ["receipt_id", "po_id", "receipt_date", "quantity", "warehouse_id"],
        {"quantity": int},
    ),
}


def feed_type(file_key: str) -> str:
    return next((x for x in SPECS if f"/{x}/" in file_key), "")


def validate(row: dict, kind: str, known: dict[str, set[str]] | None = None) -> str | None:
    fields, types = SPECS[kind]
    for field in fields:
        if field not in row or row[field] == "":
            return f"MISSING_FIELD:{field}"
    for field, typ in types.items():
        try:
            typ(row[field])
        except (ValueError, TypeError):
            return f"BAD_TYPE:{field}"
    for field in ("units_sold", "on_hand", "reorder_point", "quantity"):
        if field in row:
            try:
                if int(row[field]) < 0:
                    return f"NEGATIVE_VALUE:{field}"
            except ValueError:
                pass
    for field in ("feed_date", "receipt_date", "eta"):
        if row.get(field):
            try:
                date.fromisoformat(row[field][:10])
            except ValueError:
                return f"BAD_DATE:{field}"
    if known:
        if row.get("sku") and row["sku"] not in known.get("sku", set()):
            return "UNKNOWN_SKU"
        if row.get("warehouse_id") and row["warehouse_id"] not in known.get("warehouse_id", set()):
            return "UNKNOWN_WAREHOUSE"
        if row.get("supplier_id") and row["supplier_id"] not in known.get("supplier_id", set()):
            return "UNKNOWN_SUPPLIER"
    return None
