import csv
import gzip
import os
from datetime import date
from pathlib import Path

import pytest

from pipeline.etl import load_master
from pipeline.generator import generate

START, END = date(2024, 3, 1), date(2024, 3, 10)
CHECK_FROM = START
FEED_KINDS = ("sales", "inventory", "po_events", "receipts")


def _forget_window(connection) -> None:
    keys = [
        f"raw/{kind}/{START.fromordinal(START.toordinal() + offset).isoformat()}.csv.gz"
        for kind in FEED_KINDS
        for offset in range((END - START).days + 1)
    ]
    with connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM core.fact_sales_daily WHERE feed_date BETWEEN %s AND %s", (START, END)
        )
        cursor.execute(
            "DELETE FROM core.fact_inventory_daily WHERE feed_date BETWEEN %s AND %s",
            (START, END),
        )
        cursor.execute(
            "DELETE FROM core.fact_po_event WHERE event_time::date BETWEEN %s AND %s",
            (START, END),
        )
        cursor.execute(
            "DELETE FROM core.fact_receipt WHERE receipt_date BETWEEN %s AND %s", (START, END)
        )
        cursor.execute("DELETE FROM ops.quarantine_row WHERE file_key = ANY(%s)", (keys,))
        cursor.execute("DELETE FROM ops.etl_file WHERE file_key = ANY(%s)", (keys,))
    connection.commit()


@pytest.fixture(scope="module")
def loaded(tmp_path_factory):
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    import psycopg

    root = tmp_path_factory.mktemp("regression")
    generate(root, START, END)
    with psycopg.connect(database_url) as connection:
        _forget_window(connection)
        load_master(root, database_url=database_url)
        yield root, connection
        connection.rollback()
        _forget_window(connection)


def _first_value_per_key(root: Path, kind: str, key: str, field: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for path in sorted((root / "raw" / kind).glob("*.csv.gz")):
        with gzip.open(path, "rt", newline="") as handle:
            for row in csv.DictReader(handle):
                values.setdefault(row[key], row[field])
    return values


@pytest.mark.integration
def test_promo_flag_is_persisted_in_sales_facts(loaded):
    root, connection = loaded
    expected = _first_value_per_key(root, "sales", "sale_id", "promotion")
    stored = connection.execute(
        "SELECT sale_id, promo_flag FROM core.fact_sales_daily "
        "WHERE feed_date BETWEEN %s AND %s AND sku LIKE 'SKU-%%'",
        (CHECK_FROM, END),
    ).fetchall()
    assert len(stored) > 30_000
    assert sum(promo for _, promo in stored) > 500
    assert all(promo == (expected[sale_id] == "1") for sale_id, promo in stored)


@pytest.mark.integration
def test_disrupted_orders_have_a_later_eta_update_in_the_database(loaded):
    _, connection = loaded
    later, not_later = connection.execute(
        "SELECT count(*) FILTER (WHERE u.eta > c.eta), count(*) FILTER (WHERE u.eta <= c.eta) "
        "FROM core.fact_po_event u "
        "JOIN core.fact_po_event c ON c.po_id = u.po_id AND c.event_type = 'CREATED' "
        "WHERE u.event_type = 'ETA_UPDATED' AND u.event_time::date BETWEEN %s AND %s "
        "AND u.sku LIKE 'SKU-%%'",
        (CHECK_FROM, END),
    ).fetchone()
    assert later > 0
    assert not_later == 0


@pytest.mark.integration
def test_stored_purchase_orders_match_the_product_supplier(loaded):
    _, connection = loaded
    mismatched = connection.execute(
        "SELECT count(*) FROM core.fact_po_event e JOIN core.dim_product p USING (sku) "
        "WHERE e.supplier_id <> p.supplier_id AND e.event_time::date BETWEEN %s AND %s "
        "AND e.sku LIKE 'SKU-%%'",
        (CHECK_FROM, END),
    ).fetchone()[0]
    assert mismatched == 0
