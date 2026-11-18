from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import random
from datetime import date, timedelta
from pathlib import Path

from .storage import LocalStore, make_store

SEED = 272
CATEGORIES = ["BEV", "SNK", "DAI", "FRZ", "PCR", "HHC", "PAP", "ELE", "PHA", "OUT", "WIN", "SCH"]
CITIES = [
    ("Los Angeles", 34.05, -118.24, 1.25),
    ("Seattle", 47.61, -122.33, 1.15),
    ("Chicago", 41.88, -87.63, 1.0),
    ("Dallas", 32.78, -96.8, 1.1),
    ("New York", 40.71, -74.0, 0.95),
    ("Miami", 25.76, -80.19, 1.3),
    ("Denver", 39.74, -104.99, 0.9),
    ("Phoenix", 33.45, -112.07, 1.4),
]


def _csv_bytes(rows: list[dict], fields: list[str], gz: bool = True) -> bytes:
    import io

    raw = io.StringIO(newline="")
    writer = csv.DictWriter(raw, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    data = raw.getvalue().encode()
    if gz:
        return gzip.compress(data, compresslevel=6, mtime=0)
    return data


def catalog(rng: random.Random):
    products = []
    for i in range(500):
        category = CATEGORIES[i % len(CATEGORIES)]
        products.append(
            {
                "sku": f"SKU-{i + 1:04d}",
                "category": category,
                "product_name": f"{category} Brookline Product {i + 1:04d}",
                "unit_price": f"{rng.uniform(2, 180):.2f}",
            }
        )
    suppliers = [
        {
            "supplier_id": f"SUP-{i + 1:03d}",
            "supplier_name": f"Supplier {i + 1:03d}",
            "region": region,
            "lead_time_min": lo,
            "lead_time_max": hi,
        }
        for i, (region, lo, hi) in enumerate(
            [
                ("US-WEST", 3, 6),
                ("US-CENTRAL", 3, 6),
                ("US-EAST", 3, 6),
                ("MEXICO", 8, 14),
                ("CHINA", 30, 45),
            ]
            * 12
        )
    ]
    warehouses = [
        {
            "warehouse_id": f"WH-{i + 1:02d}",
            "warehouse_name": f"{city} Distribution Center",
            "city": city,
            "latitude": lat,
            "longitude": lon,
            "climate_scale": scale,
        }
        for i, (city, lat, lon, scale) in enumerate(CITIES)
    ]
    return products, suppliers, warehouses


def generate(root: str | Path, start: date, end: date, seed: int = SEED) -> dict:
    rng = random.Random(seed)
    store = make_store(root)
    products, suppliers, warehouses = catalog(rng)
    out = Path(root)
    if isinstance(store, LocalStore):
        out.mkdir(parents=True, exist_ok=True)
        store.put("catalog/products.csv", _csv_bytes(products, list(products[0]), False))
        store.put("catalog/suppliers.csv", _csv_bytes(suppliers, list(suppliers[0]), False))
        store.put("catalog/warehouses.csv", _csv_bytes(warehouses, list(warehouses[0]), False))
    planted, manifest = [], []
    day = start
    day_index = 0
    while day <= end:
        datestr = day.isoformat()
        sales, inventory, events, receipts = [], [], [], []
        for w in warehouses:
            for p in products:
                season = (
                    1
                    + 0.25 * (1 if day.month in (6, 7, 8, 12) else 0)
                    + 0.15 * (1 if day.weekday() >= 5 else 0)
                )
                demand = max(0, int(rng.gammavariate(4, max(0.2, season * w["climate_scale"]))))
                sid = f"S-{datestr}-{w['warehouse_id']}-{p['sku']}"
                iid = f"I-{datestr}-{w['warehouse_id']}-{p['sku']}"
                sales.append(
                    {
                        "feed_date": datestr,
                        "sale_id": sid,
                        "sku": p["sku"],
                        "warehouse_id": w["warehouse_id"],
                        "units_sold": demand,
                        "unit_price": p["unit_price"],
                    }
                )
                inventory.append(
                    {
                        "feed_date": datestr,
                        "inventory_id": iid,
                        "sku": p["sku"],
                        "warehouse_id": w["warehouse_id"],
                        "on_hand": max(0, int(rng.gauss(45, 18))),
                        "reorder_point": 28,
                    }
                )
        for i in range(2):
            po = f"PO-{datestr}-{day_index:04d}-{i}"
            p, w, s = (
                products[rng.randrange(len(products))],
                warehouses[rng.randrange(len(warehouses))],
                suppliers[rng.randrange(len(suppliers))],
            )
            events.append(
                {
                    "event_id": f"EV-{po}",
                    "po_id": po,
                    "event_type": "CREATED",
                    "event_time": f"{datestr}T08:00:00Z",
                    "supplier_id": s["supplier_id"],
                    "warehouse_id": w["warehouse_id"],
                    "sku": p["sku"],
                    "quantity": rng.randint(20, 300),
                    "eta": (
                        day + timedelta(days=rng.randint(s["lead_time_min"], s["lead_time_max"]))
                    ).isoformat(),
                }
            )
            if rng.random() < 0.7:
                receipts.append(
                    {
                        "receipt_id": f"RC-{po}",
                        "po_id": po,
                        "receipt_date": (day + timedelta(days=3)).isoformat(),
                        "quantity": events[-1]["quantity"],
                        "warehouse_id": w["warehouse_id"],
                    }
                )
        if day_index % 5 == 0:
            sales[0]["sku"] = ""
            planted.append(
                {
                    "defect_id": f"DEF-{day_index:06d}-S",
                    "file_key": f"raw/sales/{datestr}.csv.gz",
                    "line_number": 2,
                    "defect_type": "missing_sku",
                    "expected_reason": "MISSING_FIELD:sku",
                }
            )
        if day_index % 7 == 0:
            inventory[0]["on_hand"] = "bad"
            planted.append(
                {
                    "defect_id": f"DEF-{day_index:06d}-I",
                    "file_key": f"raw/inventory/{datestr}.csv.gz",
                    "line_number": 2,
                    "defect_type": "bad_type",
                    "expected_reason": "BAD_TYPE:on_hand",
                }
            )
        for name, rows, fields in [
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
        ]:
            key = f"raw/{name}/{datestr}.csv.gz"
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
    manifest_data = _csv_bytes(manifest, ["file_key", "sha256", "row_count", "feed_date"], False)
    store.put("raw/manifest.csv", manifest_data)
    eval_dir = out / "eval/erp"
    eval_dir.mkdir(parents=True, exist_ok=True)
    (eval_dir / "planted_defects.csv.gz").write_bytes(
        _csv_bytes(
            planted, ["defect_id", "file_key", "line_number", "defect_type", "expected_reason"]
        )
    )
    (eval_dir / "disruptions.csv").write_text(
        "disruption_id,disruption_type,start_date,end_date,description\n"
    )
    return {
        "files": len(manifest),
        "rows": sum(int(x["row_count"]) for x in manifest),
        "seed": seed,
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
