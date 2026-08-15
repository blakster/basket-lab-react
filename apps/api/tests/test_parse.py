import json
from pathlib import Path

import pytest

from app.db import init_db
from app.ingest.parse import load_holdings, parse_holdings_csv

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "holdings"
SAMPLE_CSV = (FIXTURES / "sample.csv").read_text()


def test_parse_holdings_csv_sample():
    rows = parse_holdings_csv(SAMPLE_CSV)
    assert len(rows) == 4
    reliance = next(r for r in rows if r["instrument_name"] == "Reliance Industries" and r["scheme_code"] == "122639")
    assert reliance["weight_pct"] == 8.5
    treps = next(r for r in rows if r["instrument_name"] == "TREPS")
    assert treps["isin"] is None
    assert treps["rating"] is None


def test_parse_holdings_csv_rejects_non_numeric_weight():
    bad = SAMPLE_CSV + "\n2026-07-31,122639,INE999,Bad,equity,Energy,,large,not-a-number\n"
    with pytest.raises(ValueError):
        parse_holdings_csv(bad)


def test_parse_holdings_csv_rejects_missing_scheme_code():
    bad = SAMPLE_CSV + "\n2026-07-31,,INE999,Bad,equity,Energy,,large,1.0\n"
    with pytest.raises(ValueError):
        parse_holdings_csv(bad)


def test_parse_holdings_csv_matches_golden():
    rows = parse_holdings_csv(SAMPLE_CSV)
    golden = json.loads((FIXTURES / "golden.json").read_text())
    assert rows == golden


def test_load_holdings_inserts_rows(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    rows = parse_holdings_csv(SAMPLE_CSV)
    n = load_holdings(conn, rows)
    assert n == 4
    count = conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
    assert count == 4


def test_load_holdings_reingest_replaces(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    rows = parse_holdings_csv(SAMPLE_CSV)
    load_holdings(conn, rows)
    n = load_holdings(conn, rows)
    assert n == 4
    count = conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
    assert count == 4
