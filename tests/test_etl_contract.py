import csv
import gzip
import os
from datetime import date
from pathlib import Path

import pytest

from pipeline.etl import _known_catalog, check_file, load_eval, load_master
from pipeline.generator import generate
from pipeline.validation import SPECS, feed_type, validate


def _manifest(root: Path) -> dict[str, dict]:
    with (root / "raw/manifest.csv").open(newline="") as handle:
        return {row["file_key"]: row for row in csv.DictReader(handle)}


def test_defect_rate_is_near_one_percent(tmp_path: Path):
    generate(tmp_path, date(2023, 1, 1), date(2023, 1, 3))
    with gzip.open(tmp_path / "eval/erp/planted_defects.csv.gz", "rt") as handle:
        defects = list(csv.DictReader(handle))
    manifest = _manifest(tmp_path)
    feed_rows = sum(
        int(row["row_count"])
        for key, row in manifest.items()
        if "/sales/" in key or "/inventory/" in key
    )
    row_defects = sum(row["line_number"] != "1" for row in defects)
    rate = row_defects / feed_rows
    assert 0.005 <= rate <= 0.02, rate


def test_feed_headers_match_specs(tmp_path: Path):
    generate(tmp_path, date(2023, 1, 1), date(2023, 1, 1))
    for path in sorted((tmp_path / "raw").glob("*/*.csv.gz")):
        key = str(path.relative_to(tmp_path)).replace("\\", "/")
        with gzip.open(path, "rt", newline="") as handle:
            header = next(csv.reader(handle))
        assert header == SPECS[feed_type(key)][0]


def test_validation_reason_and_line_number(tmp_path: Path):
    generate(tmp_path, date(2023, 1, 1), date(2023, 1, 1))
    known = _known_catalog(tmp_path)
    row = {
        "sku": "",
        "warehouse_id": "WH-01",
        "units_sold": "1",
        "unit_price": "2",
        "promotion": "0",
        "feed_date": "2023-01-01",
        "sale_id": "x",
    }
    assert validate(row, "sales", known) == "MISSING_FIELD:sku"
    good, bad = check_file(
        tmp_path / "raw/sales/2023-01-01.csv.gz", tmp_path, _manifest(tmp_path), known, "2023-01-01"
    )
    assert good
    assert any(
        item["reason_code"] == "MISSING_FIELD:sku" and item["line_number"] == 2 for item in bad
    )


def test_rerun_is_idempotent_and_tamper_is_quarantined(tmp_path: Path):
    generate(tmp_path, date(2023, 1, 1), date(2023, 1, 1))
    first = load_master(tmp_path)
    second = load_master(tmp_path)
    assert first["files"] == 4
    assert second["files"] == 0
    assert second["skipped"] == 4

    tampered = tmp_path / "tampered"
    generate(tampered, date(2023, 1, 1), date(2023, 1, 1))
    target = tampered / "raw/sales/2023-01-01.csv.gz"
    target.write_bytes(target.read_bytes() + b"tampered")
    result = load_master(tampered)
    assert result["bad_rows"] > 0
    assert "FILE_CHECKSUM_MISMATCH" in (tampered / "quarantine/rows.jsonl").read_text()


@pytest.mark.integration
def test_database_matches_every_planted_defect(tmp_path: Path):
    database_url = os.getenv("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    import psycopg

    generate(tmp_path, date(2023, 1, 1), date(2023, 1, 1))
    load_master(tmp_path, database_url=database_url)
    load_eval(tmp_path, database_url=database_url)
    with psycopg.connect(database_url) as db:
        unmatched = db.execute(
            "SELECT count(*) FROM eval.v_quality_gate_check WHERE NOT matched"
        ).fetchone()[0]
        assert unmatched == 0
