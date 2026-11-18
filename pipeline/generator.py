from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import random
from datetime import date, timedelta
from pathlib import Path

from .storage import LocalStore, make_store

SEED = 272
CATEGORIES = ["BEV", "SNK", "DAI", "FRZ", "PCR", "HHC", "PAP", "ELE", "PHA", "OUT", "WIN", "SCH"]
PRODUCT_WORDS = {
    "BEV": ["Sparkling Water Lime 12x355ml", "Cold Brew Coffee 6x250ml"],
    "SNK": ["Sea Salt Crisps 12x150g", "Honey Granola Bites 8x200g"],
    "DAI": ["Greek Yogurt Vanilla 6x150g", "Sharp Cheddar Block 400g"],
    "FRZ": ["Wild Berry Frozen Mix 1kg", "Margherita Pizza 2x400g"],
    "PCR": ["Laundry Pods Fresh 42ct", "Dishwasher Tablets 30ct"],
    "HHC": ["Cotton Bath Towel 2pk", "Bamboo Storage Basket Medium"],
    "PAP": ["Premium Paper Towels 6pk", "Recycled Copy Paper 500ct"],
    "ELE": ["USB-C Charging Cable 2m", "Wireless Desk Charger 15W"],
    "PHA": ["Daily Vitamin C 100ct", "First Aid Travel Kit 35pc"],
    "OUT": ["Trail Hydration Pack 2L", "Insulated Camp Mug 16oz"],
    "WIN": ["Fleece Winter Blanket Queen", "Thermal Hand Warmers 10pk"],
    "SCH": ["Graph Paper Notebook 3pk", "Colored Pencil Set 24ct"],
}
WAREHOUSES = [
    ("Los Angeles", 34.0522, -118.2437, 1.25, 0.85),
    ("Seattle", 47.6062, -122.3321, 1.10, 1.20),
    ("Chicago", 41.8781, -87.6298, 0.95, 1.25),
    ("Dallas", 32.7767, -96.7970, 1.20, 0.95),
    ("New York", 40.7128, -74.0060, 1.00, 1.10),
    ("Miami", 25.7617, -80.1918, 1.35, 0.80),
    ("Denver", 39.7392, -104.9903, 0.90, 1.30),
    ("Phoenix", 33.4484, -112.0740, 1.40, 0.75),
]
SUPPLIER_REGIONS = [
    ("US-WEST", 3, 6),
    ("US-CENTRAL", 3, 6),
    ("US-EAST", 3, 6),
    ("MEXICO", 8, 14),
    ("CHINA", 30, 45),
]


def _csv_bytes(rows: list[dict], fields: list[str], gz: bool = True) -> bytes:
    raw = io.StringIO(newline="")
    writer = csv.DictWriter(raw, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    data = raw.getvalue().encode()
    return gzip.compress(data, compresslevel=6, mtime=0) if gz else data


def catalog(rng: random.Random):
    products = []
    for i in range(500):
        category = CATEGORIES[i % len(CATEGORIES)]
        template = PRODUCT_WORDS[category][i % len(PRODUCT_WORDS[category])]
        products.append(
            {
                "sku": f"SKU-{i + 1:04d}",
                "category": category,
                "product_name": f"Brookline {template} {i + 1:04d}",
                "unit_price": f"{rng.uniform(2, 180):.2f}",
            }
        )
    suppliers = []
    for category in CATEGORIES:
        for region, lo, hi in SUPPLIER_REGIONS:
            suppliers.append(
                {
                    "supplier_id": f"SUP-{len(suppliers) + 1:03d}",
                    "supplier_name": f"Brookline {category} {region} Supply",
                    "category": category,
                    "region": region,
                    "lead_time_min": lo,
                    "lead_time_max": hi,
                }
            )
    warehouses = [
        {
            "warehouse_id": f"WH-{i + 1:02d}",
            "warehouse_name": f"{city} Distribution Center",
            "city": city,
            "latitude": lat,
            "longitude": lon,
            "summer_scale": summer,
            "winter_scale": winter,
            "climate_scale": (summer + winter) / 2,
        }
        for i, (city, lat, lon, summer, winter) in enumerate(WAREHOUSES)
    ]
    return products, suppliers, warehouses


def _disruptions(start: date, end: date) -> list[dict]:
    total_days = max(1, (end - start).days)
    kinds = [
        "SUPPLIER_DELAY",
        "PORT_CLOSURE",
        "HEAT_WAVE",
        "COLD_SNAP",
        "PANIC_BUYING",
        "VIRAL_PRODUCT",
    ]
    rows = []
    for i in range(40):
        offset = (
            total_days - 180 + ((i - 24) * 179 // 15)
            if i >= 24 and total_days >= 180
            else i * total_days // 40
        )
        event_date = start + timedelta(days=max(0, offset))
        kind = kinds[i % len(kinds)]
        rows.append(
            {
                "disruption_id": f"DIS-{i + 1:03d}",
                "disruption_type": kind,
                "start_date": event_date.isoformat(),
                "end_date": (event_date + timedelta(days=3)).isoformat(),
                "description": f"Planted {kind.lower().replace('_', ' ')} event",
            }
        )
    return rows


def _seasonal_multiplier(
    day: date, category: str, warehouse: dict, rng: random.Random
) -> tuple[float, bool]:
    value = 1.0 + 0.00025 * (day - date(2023, 1, 1)).days
    value += 0.12 if day.weekday() >= 5 else -0.05
    value += 0.35 if day.month in (6, 7) else 0
    value += 0.30 if day.month == 12 else 0
    value += 0.25 if day.month == 8 and category == "SCH" else 0
    value += 0.30 if day.month == 9 and category == "ELE" else 0
    value += 0.25 if day.month == 11 and day.day >= 20 else 0
    climate = warehouse["summer_scale"] if day.month in (6, 7, 8) else warehouse["winter_scale"]
    promo = rng.random() < 0.08
    return value * climate * (1.25 if promo else 1.0), promo


def _plant_row_defects(rows: list[dict], kind: str, file_key: str, planted: list[dict]) -> None:
    key = "sale_id" if kind == "sales" else "inventory_id"
    quantity_field = "units_sold" if kind == "sales" else "on_hand"
    for index in range(0, len(rows), 100):
        row = rows[index]
        mode = (index // 100) % 5
        if mode == 0:
            row["sku"] = ""
            reason, defect = "MISSING_FIELD:sku", "missing_sku"
        elif mode == 1:
            row[quantity_field] = "-7"
            reason, defect = f"NEGATIVE_VALUE:{quantity_field}", "negative_quantity"
        elif mode == 2:
            row["warehouse_id"] = "WH-UNKNOWN"
            reason, defect = "UNKNOWN_WAREHOUSE", "unknown_warehouse"
        elif mode == 3:
            row[quantity_field] = "not-a-number"
            reason, defect = f"BAD_TYPE:{quantity_field}", "non_numeric"
        else:
            row[key] = rows[index - 1][key]
            reason, defect = "DUPLICATE_KEY", "duplicate_row"
        planted.append(
            {
                "defect_id": f"DEF-{len(planted) + 1:06d}",
                "file_key": file_key,
                "line_number": index + 2,
                "defect_type": defect,
                "expected_reason": reason,
            }
        )


def generate(root: str | Path, start: date, end: date, seed: int = SEED) -> dict:
    rng = random.Random(seed)
    store = make_store(root)
    out = Path(root)
    products, suppliers, warehouses = catalog(rng)
    if isinstance(store, LocalStore):
        out.mkdir(parents=True, exist_ok=True)
        store.put("catalog/products.csv", _csv_bytes(products, list(products[0]), False))
        store.put("catalog/suppliers.csv", _csv_bytes(suppliers, list(suppliers[0]), False))
        store.put("catalog/warehouses.csv", _csv_bytes(warehouses, list(warehouses[0]), False))
    disruptions = _disruptions(start, end)
    disruption_dates = {x["start_date"]: x for x in disruptions}
    planted, manifest = [], []
    history: dict[tuple[str, str], list[int]] = {}
    day = start
    day_index = 0
    total_days = (end - start).days + 1
    while day <= end:
        datestr = day.isoformat()
        sales, inventory, events, receipts = [], [], [], []
        event = disruption_dates.get(datestr)
        for warehouse in warehouses:
            for product in products:
                multiplier, promo = _seasonal_multiplier(day, product["category"], warehouse, rng)
                history_key = (warehouse["warehouse_id"], product["sku"])
                moving_average = sum(history.get(history_key, [])[-28:]) / max(
                    1, len(history.get(history_key, []))
                )
                scale = (
                    max(0.25, (moving_average / 4) * multiplier)
                    if moving_average
                    else max(0.25, multiplier)
                )
                demand = max(0, int(rng.gammavariate(4.0, scale)))
                history.setdefault(history_key, []).append(demand)
                sid = f"S-{datestr}-{warehouse['warehouse_id']}-{product['sku']}"
                iid = f"I-{datestr}-{warehouse['warehouse_id']}-{product['sku']}"
                reorder_point = max(1, int(moving_average * 1.35))
                on_hand = max(
                    0, int(rng.gauss(reorder_point * 1.3 - demand, max(2, reorder_point * 0.25)))
                )
                sales.append(
                    {
                        "feed_date": datestr,
                        "sale_id": sid,
                        "sku": product["sku"],
                        "warehouse_id": warehouse["warehouse_id"],
                        "units_sold": demand,
                        "unit_price": product["unit_price"],
                        "promotion": int(promo),
                    }
                )
                inventory.append(
                    {
                        "feed_date": datestr,
                        "inventory_id": iid,
                        "sku": product["sku"],
                        "warehouse_id": warehouse["warehouse_id"],
                        "on_hand": on_hand,
                        "reorder_point": reorder_point,
                    }
                )
        for i in range(2):
            product, warehouse, supplier = (
                products[rng.randrange(len(products))],
                warehouses[rng.randrange(len(warehouses))],
                suppliers[rng.randrange(len(suppliers))],
            )
            po = f"PO-{datestr}-{day_index:04d}-{i}"
            lead_time = rng.randint(supplier["lead_time_min"], supplier["lead_time_max"])
            if rng.random() < 0.12:
                lead_time += rng.randint(2, 10)
            events.append(
                {
                    "event_id": f"EV-{po}",
                    "po_id": po,
                    "event_type": "CREATED",
                    "event_time": f"{datestr}T08:00:00Z",
                    "supplier_id": supplier["supplier_id"],
                    "warehouse_id": warehouse["warehouse_id"],
                    "sku": product["sku"],
                    "quantity": rng.randint(20, 300),
                    "eta": (day + timedelta(days=lead_time)).isoformat(),
                }
            )
            if event and event["disruption_type"] in ("SUPPLIER_DELAY", "PORT_CLOSURE"):
                events.append(
                    {
                        **events[-1],
                        "event_id": f"ETA-{po}",
                        "event_type": "ETA_UPDATED",
                        "event_time": f"{datestr}T12:00:00Z",
                        "eta": (day + timedelta(days=lead_time + 7)).isoformat(),
                    }
                )
            if rng.random() < 0.7:
                receipts.append(
                    {
                        "receipt_id": f"RC-{po}",
                        "po_id": po,
                        "receipt_date": (day + timedelta(days=lead_time)).isoformat(),
                        "quantity": events[0]["quantity"],
                        "warehouse_id": warehouse["warehouse_id"],
                    }
                )
        rows_by_kind = [
            ("sales", sales, list(sales[0])),
            ("inventory", inventory, list(inventory[0])),
            ("po_events", events, list(events[0])),
            (
                "receipts",
                receipts,
                list(receipts[0])
                if receipts
                else ["receipt_id", "po_id", "receipt_date", "quantity", "warehouse_id"],
            ),
        ]
        if total_days > 2 and day_index in (total_days // 3, (2 * total_days) // 3):
            renamed_inventory = []
            for row in inventory:
                renamed = dict(row)
                renamed["onhand"] = renamed.pop("on_hand")
                renamed_inventory.append(renamed)
            inventory = renamed_inventory
            rows_by_kind[1] = (
                "inventory",
                inventory,
                ["feed_date", "inventory_id", "sku", "warehouse_id", "onhand", "reorder_point"],
            )
            planted.append(
                {
                    "defect_id": f"DEF-SCHEMA-{day_index:06d}",
                    "file_key": f"raw/inventory/{datestr}.csv.gz",
                    "line_number": 1,
                    "defect_type": "renamed_column",
                    "expected_reason": "FILE_SCHEMA_MISMATCH",
                }
            )
        for name, rows, fields in rows_by_kind:
            key = f"raw/{name}/{datestr}.csv.gz"
            if name == "sales" or (name == "inventory" and "on_hand" in fields):
                _plant_row_defects(rows, name, key, planted)
            data = _csv_bytes(rows, fields)
            store.put(key, data)
            manifest.append(
                {
                    "file_key": key,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "row_count": len(rows),
                    "feed_date": datestr,
                }
            )
        day += timedelta(days=1)
        day_index += 1
    store.put(
        "raw/manifest.csv",
        _csv_bytes(manifest, ["file_key", "sha256", "row_count", "feed_date"], False),
    )
    eval_dir = out / "eval/erp"
    eval_dir.mkdir(parents=True, exist_ok=True)
    (eval_dir / "planted_defects.csv.gz").write_bytes(
        _csv_bytes(
            planted, ["defect_id", "file_key", "line_number", "defect_type", "expected_reason"]
        )
    )
    (eval_dir / "disruptions.csv").write_bytes(
        _csv_bytes(
            disruptions,
            ["disruption_id", "disruption_type", "start_date", "end_date", "description"],
            False,
        )
    )
    return {
        "files": len(manifest),
        "rows": sum(int(x["row_count"]) for x in manifest),
        "seed": seed,
        "planted_defects": len(planted),
        "disruptions": len(disruptions),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic ERP feeds")
    parser.add_argument("--output", default="data")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2023, 1, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date(2025, 12, 31))
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()
    print(json.dumps(generate(args.output, args.start, args.end, args.seed)))


if __name__ == "__main__":
    main()
