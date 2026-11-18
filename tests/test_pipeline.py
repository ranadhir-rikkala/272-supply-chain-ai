from datetime import date
from pathlib import Path

from pipeline.etl import load_master
from pipeline.generator import generate


def test_generator_is_byte_deterministic(tmp_path: Path):
    a, b = tmp_path / "a", tmp_path / "b"
    generate(a, date(2023, 1, 1), date(2023, 1, 2))
    generate(b, date(2023, 1, 1), date(2023, 1, 2))
    files_a = sorted(x.relative_to(a) for x in a.rglob("*") if x.is_file())
    files_b = sorted(x.relative_to(b) for x in b.rglob("*") if x.is_file())
    assert files_a == files_b
    assert all((a / f).read_bytes() == (b / f).read_bytes() for f in files_a)


def test_loader_quarantines_planted_rows(tmp_path: Path):
    generate(tmp_path, date(2023, 1, 1), date(2023, 1, 1))
    result = load_master(tmp_path)
    assert result["files"] == 4
    assert result["bad_rows"] == 2
    assert "MISSING_FIELD:sku" in (tmp_path / "quarantine/rows.jsonl").read_text()
