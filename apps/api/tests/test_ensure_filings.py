from pathlib import Path

from app.ingest.amc_fetch import FetchResult, missing_scheme_codes, pick_latest_monthly_url
from app.ingest.ensure import ensure_filings
from app.ingest.scheme_master import SchemeMaster


def test_pick_latest_monthly_skips_fortnightly():
    urls = [
        "https://x/NIMF-FORTNIGHTLY-PORTFOLIO-31-July-26.xls",
        "https://x/NIMF-MONTHLY-PORTFOLIO-30-Jun-26.xls",
        "https://x/NIMF-MONTHLY-PORTFOLIO-31-July-26.xls",
        "https://x/RiskParameter-Jul-2026.xls",
    ]
    assert pick_latest_monthly_url(urls).endswith("NIMF-MONTHLY-PORTFOLIO-31-July-26.xls")


def test_pick_latest_monthly_rejects_an_older_requested_month():
    urls = ["https://x/NIMF-MONTHLY-PORTFOLIO-31-July-26.xls"]

    assert pick_latest_monthly_url(urls, month="2026-08") is None


def test_missing_scheme_codes(db):
    assert missing_scheme_codes(db, ["122639", "118741"]) == ["118741"]
    assert missing_scheme_codes(db, ["122639", "140084"]) == []


def test_ensure_filings_ingests_downloaded_workbook(db, tmp_path, monkeypatch):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "NF"
    ws.append(["Nippon India Index Fund - Nifty 50 Plan (An open ended scheme)"])
    ws.append(["Name of the Instrument", "ISIN", "Industry / Rating", "% to Net Assets"])
    ws.append(["HDFC Bank Limited", "INE040A01034", "Banks", 0.12])
    path = tmp_path / "nip.xlsx"
    wb.save(path)

    master = SchemeMaster.from_rows(
        [
            {
                "scheme_code": "118741",
                "scheme_name": "Nippon India Index Fund - Nifty 50 Plan - Direct Plan Growth Plan - Growth Option",
                "isin": "INF204K01H36",
                "amc": "Nippon India Mutual Fund",
            }
        ]
    )

    monkeypatch.setattr(
        "app.ingest.ensure.fetch_amc_portfolio",
        lambda amc, month, dest: FetchResult([path], "https://amc.example/nip.xlsx"),
    )
    result = ensure_filings(
        db,
        ["118741"],
        month="2026-07",
        incoming=tmp_path,
        master=master,
    )
    assert result["fetched"] == 1
    assert result["missing"] == []
    row = db.execute(
        "SELECT instrument_name, weight_pct FROM holdings WHERE scheme_code='118741'"
    ).fetchone()
    assert row[0] == "HDFC Bank Limited"
    assert float(row[1]) == 12.0


def test_ensure_records_download_failure_for_each_affected_scheme(db, tmp_path, monkeypatch):
    master = SchemeMaster.from_rows(
        [{"scheme_code": "118741", "amc": "Nippon India Mutual Fund"}]
    )
    monkeypatch.setattr(
        "app.ingest.ensure.fetch_amc_portfolio",
        lambda *_: FetchResult([], "https://amc.example/xls", "download-failed"),
    )

    result = ensure_filings(
        db, ["118741"], month="2026-08", incoming=tmp_path, master=master
    )

    assert result["filings"][0]["state"] == "download-failed"
    assert result["filings"][0]["sourceUrl"] == "https://amc.example/xls"


def test_ensure_records_missing_source(db, tmp_path, monkeypatch):
    master = SchemeMaster.from_rows(
        [{"scheme_code": "118741", "amc": "Nippon India Mutual Fund"}]
    )
    monkeypatch.setattr(
        "app.ingest.ensure.fetch_amc_portfolio",
        lambda *_: FetchResult([], "https://amc.example/portfolio", "missing-source"),
    )

    result = ensure_filings(
        db, ["118741"], month="2026-08", incoming=tmp_path, master=master
    )

    assert result["filings"][0]["state"] == "missing-source"


def test_ensure_marks_downloaded_but_unjoined_file_as_parse_failed(db, tmp_path, monkeypatch):
    path = tmp_path / "unjoined.csv"
    path.write_text("not,a,holdings,file\n", encoding="utf-8")
    master = SchemeMaster.from_rows(
        [{"scheme_code": "118741", "amc": "Nippon India Mutual Fund"}]
    )
    monkeypatch.setattr(
        "app.ingest.ensure.fetch_amc_portfolio",
        lambda *_: FetchResult([path], "https://amc.example/portfolio.xlsx"),
    )

    result = ensure_filings(
        db, ["118741"], month="2026-08", incoming=tmp_path, master=master
    )

    assert result["filings"][0]["state"] == "parse-failed"


def test_ensure_records_unmapped_scheme(db, tmp_path):
    result = ensure_filings(
        db,
        ["999999"],
        month="2026-08",
        incoming=tmp_path,
        master=SchemeMaster.from_rows([]),
    )

    assert result["filings"][0]["state"] == "unmapped"


def test_ensure_fetches_an_amc_once_for_multiple_schemes(db, tmp_path, monkeypatch):
    master = SchemeMaster.from_rows(
        [
            {"scheme_code": "118741", "amc": "Nippon India Mutual Fund"},
            {"scheme_code": "999999", "amc": "Nippon India Mutual Fund"},
        ]
    )
    calls = []

    def fetch_once(amc, month, dest):
        calls.append((amc, month, dest))
        return FetchResult([], "https://amc.example/portfolio", "missing-source")

    monkeypatch.setattr("app.ingest.ensure.fetch_amc_portfolio", fetch_once)

    result = ensure_filings(
        db,
        ["118741", "999999"],
        month="2026-08",
        incoming=tmp_path,
        master=master,
    )

    assert len(calls) == 1
    assert [filing["state"] for filing in result["filings"]] == [
        "missing-source",
        "missing-source",
    ]


def test_ensure_keeps_existing_holding_when_download_fails(db, tmp_path, monkeypatch):
    db.execute(
        """
        INSERT INTO holdings (
            as_of, scheme_code, isin, instrument_name, asset_class, sector, rating,
            market_cap_bucket, weight_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("2026-07-31", "118741", "INE000000001", "Cached Holding", None, None, None, None, 10.0),
    )
    db.commit()
    master = SchemeMaster.from_rows(
        [{"scheme_code": "118741", "amc": "Nippon India Mutual Fund"}]
    )
    monkeypatch.setattr(
        "app.ingest.ensure.fetch_amc_portfolio",
        lambda *_: FetchResult([], "https://amc.example/xls", "download-failed"),
    )

    result = ensure_filings(
        db, ["118741"], month="2026-08", incoming=tmp_path, master=master
    )

    assert result["filings"][0]["state"] == "stale"
    assert db.execute(
        "SELECT COUNT(*) FROM holdings WHERE scheme_code = '118741' AND as_of = '2026-07-31'"
    ).fetchone()[0] == 1
