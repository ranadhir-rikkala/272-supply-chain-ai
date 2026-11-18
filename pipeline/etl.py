from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import uuid
from pathlib import Path

from .messaging import FeedConsumer
from .validation import SPECS, feed_type, validate


def read_rows(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", newline="") as handle:
        yield from csv.DictReader(handle)


def check_file(path: Path, root: Path, manifest: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    key = str(path.relative_to(root)).replace("\\", "/")
    kind = feed_type(key)
    errors, good = [], []
    expected = manifest.get(key)
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if not expected or actual != expected["sha256"]:
        return [], [{"line_number": 0, "reason_code": "FILE_CHECKSUM_MISMATCH", "raw": {}}]
    rows = list(read_rows(path))
    fields = list(rows[0]) if rows else []
    if kind and fields != SPECS[kind][0]:
        return [], [{"line_number": 1, "reason_code": "FILE_SCHEMA_MISMATCH", "raw": {}}]
    seen = set()
    key_field = {
        "sales": "sale_id",
        "inventory": "inventory_id",
        "po_events": "event_id",
        "receipts": "receipt_id",
    }.get(kind)
    for line, row in enumerate(rows, 2):
        reason = validate(row, kind) if kind else "UNKNOWN_FEED"
        if not reason and key_field and row[key_field] in seen:
            reason = "DUPLICATE_KEY"
        seen.add(row.get(key_field, ""))
        (errors if reason else good).append(
            {"line_number": line, "reason_code": reason, "raw": row} if reason else row
        )
    if rows and len(errors) / len(rows) > 0.05:
        errors = [{"line_number": 0, "reason_code": "QUALITY_GATE_REJECTED", "raw": {}}] + errors
        good = []
    return good, errors


def load_master(root: str, database_url: str | None = None) -> dict:
    root_path = Path(root)
    manifest = {
        row["file_key"]: row for row in csv.DictReader((root_path / "raw/manifest.csv").open())
    }
    run_id = str(uuid.uuid4())
    results = {"run_id": run_id, "files": 0, "good_rows": 0, "bad_rows": 0}
    quarantine = root_path / "quarantine"
    archive = root_path / "archive"
    db = None
    if database_url or os.getenv("DATABASE_URL"):
        import psycopg

        db = psycopg.connect(database_url or os.environ["DATABASE_URL"])
        db.execute(
            "INSERT INTO ops.etl_run (etl_run_id, source) VALUES (%s, %s)", (run_id, str(root))
        )
        for filename, table, columns in [
            (
                "products.csv",
                "core.dim_product",
                [
                    "sku",
                    "category",
                    "product_name",
                    "supplier_id",
                    "case_pack",
                    "unit_cost",
                    "unit_price",
                ],
            ),
            (
                "suppliers.csv",
                "core.dim_supplier",
                ["supplier_id", "supplier_name", "region", "lead_time_mean", "lead_time_sd"],
            ),
            (
                "warehouses.csv",
                "core.dim_warehouse",
                [
                    "warehouse_id",
                    "warehouse_name",
                    "city",
                    "latitude",
                    "longitude",
                    "climate_scale",
                ],
            ),
        ]:
            rows = list(csv.DictReader((root_path / "catalog" / filename).open()))
            if rows:
                placeholders = ",".join(["%s"] * len(columns))
                db.executemany(
                    f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders}) ON CONFLICT DO NOTHING",
                    [tuple(r[c] for c in columns) for r in rows],
                )
        db.commit()
    for path in sorted((root_path / "raw").glob("*/*.csv.gz")):
        good, bad = check_file(path, root_path, manifest)
        results["files"] += 1
        results["good_rows"] += len(good)
        results["bad_rows"] += len(bad)
        key = str(path.relative_to(root_path)).replace("\\", "/")
        if bad:
            qpath = quarantine / key.replace("raw/", "")
            qpath.parent.mkdir(parents=True, exist_ok=True)
            qpath.write_bytes(path.read_bytes())
            with (quarantine / "rows.jsonl").open("a") as q:
                for row in bad:
                    q.write(json.dumps({"file_key": key, "etl_run_id": run_id, **row}) + "\n")
        else:
            dest = archive / key.removeprefix("raw/")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(path.read_bytes())
            if db and good:
                kind = feed_type(key)
                if kind == "sales":
                    db.executemany(
                        "INSERT INTO core.fact_sales_daily (feed_date,sale_id,sku,warehouse_id,units_sold,unit_price,etl_run_id) VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                        [
                            (
                                r["feed_date"],
                                r["sale_id"],
                                r["sku"],
                                r["warehouse_id"],
                                int(r["units_sold"]),
                                r["unit_price"],
                                run_id,
                            )
                            for r in good
                        ],
                    )
                elif kind == "inventory":
                    db.executemany(
                        "INSERT INTO core.fact_inventory_daily (feed_date,inventory_id,sku,warehouse_id,on_hand,on_order,reorder_point,stockout_flag,etl_run_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                        [
                            (
                                r["feed_date"],
                                r["inventory_id"],
                                r["sku"],
                                r["warehouse_id"],
                                int(r["on_hand"]),
                                int(r["on_order"]),
                                int(r["reorder_point"]),
                                r["stockout_flag"] == "1",
                                run_id,
                            )
                            for r in good
                        ],
                    )
                db.commit()
    if db:
        db.execute(
            "UPDATE ops.etl_run SET finished_at=now(), status='SUCCEEDED' WHERE etl_run_id=%s",
            (run_id,),
        )
        db.commit()
        db.close()
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    master = sub.add_parser("load-master")
    master.add_argument("--root", default="data")
    load = sub.add_parser("load")
    load.add_argument("--root", default="data")
    sub.add_parser("status")
    sub.add_parser("enqueue")
    sub.add_parser("worker")
    args = parser.parse_args()
    if args.command in ("load-master", "load"):
        print(json.dumps(load_master(args.root)))
    elif args.command == "status":
        print(json.dumps({"status": "ready"}))
    elif args.command == "enqueue":
        print(
            json.dumps({"status": "queued", "note": "Use scetl worker to consume feed messages."})
        )
    else:
        FeedConsumer(lambda message: None).run()


if __name__ == "__main__":
    main()
