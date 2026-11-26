import csv
import gzip
from datetime import date
from pathlib import Path

import pytest

from pipeline.generator import black_friday, demand_multiplier, generate

WAREHOUSE = {"summer_scale": 1.0, "winter_scale": 1.0}


def _rows(root: Path, kind: str) -> list[dict]:
    rows = []
    for path in sorted((root / "raw" / kind).glob("*.csv.gz")):
        with gzip.open(path, "rt", newline="") as handle:
            rows.extend(csv.DictReader(handle))
    return rows


@pytest.fixture(scope="module")
def sixty_days(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("feeds")
    generate(root, date(2023, 1, 1), date(2023, 3, 1))
    return root


def _units(rows: list[dict]) -> list[int]:
    return [int(row["units_sold"]) for row in rows if row["units_sold"].isdigit()]


def test_demand_does_not_decay_over_time(sixty_days: Path):
    sales = _rows(sixty_days, "sales")
    first_week = _units([row for row in sales if row["feed_date"] <= "2023-01-07"])
    last_week = _units([row for row in sales if row["feed_date"] >= "2023-02-23"])
    first_mean = sum(first_week) / len(first_week)
    last_mean = sum(last_week) / len(last_week)
    assert first_mean > 5
    assert 0.8 < last_mean / first_mean < 1.25


def test_seasonality_differs_by_category():
    january, july = date(2024, 1, 15), date(2024, 7, 15)
    assert demand_multiplier(january, "WIN", WAREHOUSE) > 2 * demand_multiplier(
        july, "WIN", WAREHOUSE
    )
    assert demand_multiplier(july, "BEV", WAREHOUSE) > 1.4 * demand_multiplier(
        january, "BEV", WAREHOUSE
    )
    assert demand_multiplier(date(2024, 8, 15), "SCH", WAREHOUSE) > 1.8 * demand_multiplier(
        date(2024, 5, 15), "SCH", WAREHOUSE
    )
    friday = black_friday(2024)
    assert friday == date(2024, 11, 29)
    assert demand_multiplier(friday, "ELE", WAREHOUSE) > 2 * demand_multiplier(
        date(2024, 11, 15), "ELE", WAREHOUSE
    )


def test_reorder_policy_creates_orders_and_receipts_on_arrival(sixty_days: Path):
    events = _rows(sixty_days, "po_events")
    receipts = _rows(sixty_days, "receipts")
    created = {row["po_id"]: row for row in events if row["event_type"] == "CREATED"}
    assert len(created) > 1000
    for path in sorted((sixty_days / "raw/receipts").glob("*.csv.gz")):
        with gzip.open(path, "rt", newline="") as handle:
            assert all(row["receipt_date"] == path.name[:10] for row in csv.DictReader(handle))
    assert receipts
    assert all(row["po_id"] in created for row in receipts)
    for row in receipts[:200]:
        assert int(row["quantity"]) == int(created[row["po_id"]]["quantity"])


def test_stockouts_happen_but_are_not_the_norm(sixty_days: Path):
    flags = [
        row["stockout_flag"] for row in _rows(sixty_days, "inventory") if "stockout_flag" in row
    ]
    share = flags.count("True") / len(flags)
    assert 0.0 < share < 0.2


def test_promotions_lower_the_price(sixty_days: Path):
    products = {
        row["sku"]: float(row["unit_price"])
        for row in csv.DictReader((sixty_days / "catalog/products.csv").open())
    }
    promoted = [
        row for row in _rows(sixty_days, "sales") if row["promo_flag"] == "1" and row["sku"]
    ]
    assert promoted
    assert all(float(row["unit_price"]) < products[row["sku"]] for row in promoted)


def _po_events(root: Path) -> tuple[dict[str, dict], list[dict]]:
    created, updated = {}, []
    for row in _rows(root, "po_events"):
        if row["event_type"] == "CREATED":
            created[row["po_id"]] = row
        elif row["event_type"] == "ETA_UPDATED":
            updated.append(row)
    return created, updated


def test_eta_update_moves_the_eta_later_than_created(sixty_days: Path):
    created, updated = _po_events(sixty_days)
    assert updated
    for row in updated:
        original = created[row["po_id"]]
        assert row["eta"] > original["eta"], row["po_id"]
        assert row["event_time"][:10] > original["event_time"][:10]


def test_disrupted_orders_are_received_on_the_updated_eta(sixty_days: Path):
    _, updated = _po_events(sixty_days)
    latest_eta = {}
    for row in updated:
        latest_eta[row["po_id"]] = max(latest_eta.get(row["po_id"], ""), row["eta"])
    receipts = {row["po_id"]: row for row in _rows(sixty_days, "receipts")}
    received = [po for po in latest_eta if po in receipts]
    assert received
    assert all(receipts[po]["receipt_date"] == latest_eta[po] for po in received)


def test_purchase_order_supplier_is_the_product_catalog_supplier(sixty_days: Path):
    catalog_supplier = {
        row["sku"]: row["supplier_id"]
        for row in csv.DictReader((sixty_days / "catalog/products.csv").open())
    }
    created, updated = _po_events(sixty_days)
    for row in [*created.values(), *updated]:
        assert row["supplier_id"] == catalog_supplier[row["sku"]], row["po_id"]
