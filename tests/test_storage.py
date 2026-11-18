from pathlib import Path

import pytest

from pipeline.storage import LocalStore, make_store, sha256


def test_local_store_round_trip(tmp_path: Path):
    store = LocalStore(tmp_path)
    payload = b"deterministic feed"
    assert store.put("raw/day.csv", payload) == sha256(payload)
    assert store.exists("raw/day.csv")
    assert store.get("raw/day.csv") == payload
    store.delete("raw/day.csv")
    assert not store.exists("raw/day.csv")


def test_store_selection(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("STORE", "local")
    assert isinstance(make_store(tmp_path), LocalStore)
    monkeypatch.setenv("STORE", "filesystem")
    with pytest.raises(ValueError, match="Unsupported STORE backend"):
        make_store(tmp_path)
