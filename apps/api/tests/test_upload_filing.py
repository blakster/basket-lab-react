from datetime import datetime, timezone
from pathlib import Path

from app.ingest.parse import load_holdings, parse_holdings_csv
from app.ingest.upload import upload_filing


def test_upload_stamps_scheme_and_replaces_old_month(db, tmp_path):
    load_holdings(db, parse_holdings_csv(
        "as_of,scheme_code,isin,instrument_name,asset_class,sector,rating,market_cap_bucket,weight_pct\n"
        "2026-01-31,148401,INEOLD,Old Name,equity,Banks,,,10\n"
    ))
    from tests.test_excel import _icici_like_book
    path = _icici_like_book(tmp_path / "flex.xlsx")
    status = upload_filing(db, "148401", path, month="2026-07")
    assert status.scheme_code == "148401"
    assert status.as_of == "2026-07-31"
    assert status.state == "fresh"
    assert status.reason == "user upload"
    assert status.source_url is None
    old = db.execute("SELECT COUNT(*) FROM holdings WHERE scheme_code='148401' AND as_of='2026-01-31'").fetchone()[0]
    assert old == 0
    tvs = db.execute(
        "SELECT weight_pct FROM holdings WHERE scheme_code='148401' AND isin='INE494B01023'"
    ).fetchone()
    assert tvs is not None
    funda = db.execute(
        "SELECT aum_cr, turnover FROM fundamentals WHERE scheme_code='148401'"
    ).fetchone()
    assert funda["turnover"] == 0.26


def test_post_upload_rejects_pdf_and_keeps_holdings(client, db, tmp_path):
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF-1.4 junk")
    prior = db.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
    res = client.post(
        "/api/ingest/upload",
        data={"schemeCode": "122639"},
        files={"file": ("x.pdf", pdf.read_bytes(), "application/pdf")},
    )
    assert res.status_code == 422
    assert "5 MB" in res.json()["message"] or "xlsx" in res.json()["message"].lower()
    assert db.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == prior


def test_post_upload_rejects_oversize_and_keeps_holdings(client, db):
    from app.ingest.upload import MAX_BYTES, REJECT_MESSAGE

    prior = db.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
    res = client.post(
        "/api/ingest/upload",
        data={"schemeCode": "122639"},
        files={"file": ("big.xlsx", b"x" * (MAX_BYTES + 1),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 422
    assert res.json()["message"] == REJECT_MESSAGE
    assert db.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == prior


def test_post_upload_empty_table_is_422(client, tmp_path):
    from openpyxl import Workbook
    path = tmp_path / "empty.xlsx"
    wb = Workbook()
    wb.active["A1"] = "hello"
    wb.save(path)
    res = client.post(
        "/api/ingest/upload",
        data={"schemeCode": "122639"},
        files={"file": ("empty.xlsx", path.read_bytes(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 422
    assert res.json()["error"] == "parse-failed"
    assert res.json()["message"] == "No holdings table in this file."
