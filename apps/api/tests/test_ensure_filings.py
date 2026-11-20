import threading
from datetime import datetime, timezone

from app.db import init_db
from app.filing_status import FilingStatus, filing_statuses, record_filing_status
from app.ingest.amc_fetch import missing_scheme_codes, pick_latest_monthly_url
from app.ingest.ensure import (
    _serialize_status,
    _status_for,
    ensure_filings,
)
from app.ingest.foliyo import FoliyoError, persist_fund_details
from app.ingest.parse import load_holdings, parse_holdings_csv
from conftest import SAMPLE_CSV
from test_foliyo import PAYLOAD


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


def test_ensure_filings_ingests_foliyo_details(db):
    result = ensure_filings(
        db,
        ["118741"],
        month="2026-09",
        fetch=lambda _code: PAYLOAD,
    )
    assert result["fetched"] == 1
    assert result["missing"] == []
    assert result["filings"][0]["state"] == "fresh"
    assert result["filings"][0]["amc"] == "PPFAS Asset Management Pvt. Ltd"
    row = db.execute(
        "SELECT instrument_name, weight_pct FROM holdings WHERE scheme_code='118741'"
    ).fetchone()
    assert row[0] == "HDFC Bank Ltd"
    assert float(row[1]) == 7.75


def test_ensure_records_download_failure(db):
    def boom(_code: str):
        raise FoliyoError("download-failed", "foliyo request failed")

    result = ensure_filings(db, ["118741"], month="2026-08", fetch=boom)

    assert result["filings"][0]["state"] == "download-failed"
    assert result["filings"][0]["reason"] == "foliyo request failed"


def test_ensure_records_unmapped_scheme(db):
    def unknown(_code: str):
        raise FoliyoError("unmapped", "Unknown instrument '999999'")

    result = ensure_filings(db, ["999999"], month="2026-08", fetch=unknown)

    assert result["filings"][0]["state"] == "unmapped"


def test_ensure_marks_empty_payload_as_parse_failed(db):
    def empty(_code: str):
        return {"name": "X"}

    result = ensure_filings(db, ["118741"], month="2026-08", fetch=empty)

    assert result["filings"][0]["state"] == "parse-failed"


def test_ensure_fetches_each_pending_scheme(db):
    calls: list[str] = []

    def fail(code: str):
        calls.append(code)
        raise FoliyoError("download-failed", "foliyo request failed")

    result = ensure_filings(db, ["118741", "999999"], month="2026-08", fetch=fail)

    assert calls == ["118741", "999999"]
    assert [filing["state"] for filing in result["filings"]] == [
        "download-failed",
        "download-failed",
    ]


def test_ensure_keeps_existing_holding_when_download_fails(db):
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

    def boom(_code: str):
        raise FoliyoError("download-failed", "foliyo request failed")

    result = ensure_filings(db, ["118741"], month="2026-08", fetch=boom)

    assert result["filings"][0]["state"] == "stale"
    assert db.execute(
        "SELECT COUNT(*) FROM holdings WHERE scheme_code = '118741' AND as_of = '2026-07-31'"
    ).fetchone()[0] == 1


def test_post_ensure_refreshes_stale_schemes_and_returns_filings(client, monkeypatch):
    called: list[list[str]] = []

    def fake_ensure(conn, codes, *, month=None, incoming=None, master=None, fetch=None):
        called.append(list(codes))
        return {
            "fetched": 0,
            "missing": [],
            "amcs": [],
            "filings": [
                {
                    "schemeCode": codes[0],
                    "state": "stale",
                    "requestedMonth": month or "2026-08",
                    "attemptedAt": "2026-08-16T00:00:00+00:00",
                    "finishedAt": "2026-08-16T00:00:01+00:00",
                    "asOf": "2026-07-31",
                    "amc": "PPFAS Asset Management Pvt. Ltd",
                    "sourceUrl": "https://foliyo.ai/mutual-funds/?isin=INF879O01027",
                    "reason": "download-failed",
                }
            ],
        }

    monkeypatch.setattr("app.main.ensure_filings", fake_ensure)

    res = client.post("/api/ingest/ensure", json={"schemeCodes": ["122639"]})

    assert res.status_code == 200
    data = res.json()
    assert called == [["122639"]]
    assert data["filings"][0]["schemeCode"] == "122639"
    assert data["filings"][0]["state"] == "stale"


def test_ensure_mixed_codes_preserves_fresh_fund_provenance(db):
    db.execute(
        """
        INSERT INTO holdings (
            as_of, scheme_code, isin, instrument_name, asset_class, sector, rating,
            market_cap_bucket, weight_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("2026-08-15", "111111", "INE000000111", "Fresh Holding", None, None, None, None, 10.0),
    )
    db.commit()
    record_filing_status(
        db,
        FilingStatus(
            scheme_code="111111",
            state="fresh",
            requested_month="2026-08",
            attempted_at="2026-08-01T00:00:00+00:00",
            finished_at="2026-08-01T00:00:01+00:00",
            as_of="2026-08-15",
            amc="PPFAS Mutual Fund",
            source_url="https://foliyo.ai/mutual-funds/?isin=INF879O01027",
            reason="already current",
        ),
    )

    def boom(code: str):
        if code == "111111":
            raise AssertionError("fresh scheme should not fetch")
        raise FoliyoError("unmapped", "Unknown instrument")

    result = ensure_filings(db, ["111111", "999999"], month="2026-08", fetch=boom)

    by_code = {filing["schemeCode"]: filing for filing in result["filings"]}
    assert by_code["111111"]["state"] == "fresh"
    assert by_code["111111"]["sourceUrl"] == "https://foliyo.ai/mutual-funds/?isin=INF879O01027"
    assert by_code["111111"]["reason"] == "already current"
    assert by_code["111111"]["amc"] == "PPFAS Mutual Fund"
    assert by_code["999999"]["state"] == "unmapped"


def test_ensure_fetches_pending_codes_concurrently(db):
    # A barrier that only releases when all three fetches are in flight at
    # once: the sequential loop would break it (and raise) instead.
    barrier = threading.Barrier(3, timeout=10)

    def fetch(_code: str):
        barrier.wait()
        return PAYLOAD

    result = ensure_filings(db, ["118741", "122639", "999999"], month="2026-09", fetch=fetch)

    assert result["fetched"] == 3


def _sequential_ensure(conn, scheme_codes, *, month, fetch):
    """Reference: the pre-parallel loop, one fetch and persist at a time."""
    codes = list(dict.fromkeys(str(code).strip() for code in scheme_codes if str(code).strip()))
    existing = filing_statuses(conn, codes, month)
    pending = [code for code in codes if existing[code].state != "fresh"]

    outcomes = {}
    houses: list[str] = []
    fetched = 0
    for code in pending:
        try:
            saved = persist_fund_details(conn, code, fetch(code))
        except FoliyoError as exc:
            outcomes[code] = (exc.failure, None, None, exc.reason)
            continue
        fetched += 1
        if saved.amc:
            houses.append(saved.amc)
        outcomes[code] = ("fresh", saved.amc, saved.source_url, None)

    now = datetime.now(timezone.utc).isoformat()
    statuses = []
    for code in codes:
        if code not in pending:
            statuses.append(existing[code])
            continue
        statuses.append(_status_for(conn, code, month, now, existing[code], outcomes.get(code)))
        record_filing_status(conn, statuses[-1])

    return {
        "fetched": fetched,
        "missing": missing_scheme_codes(conn, codes),
        "amcs": list(dict.fromkeys(houses)),
        "filings": [_serialize_status(status) for status in statuses],
    }


def _seeded_db(tmp_path, name):
    conn = init_db(tmp_path / name)
    load_holdings(conn, parse_holdings_csv(SAMPLE_CSV))
    conn.execute(
        """
        INSERT INTO holdings (
            as_of, scheme_code, isin, instrument_name, asset_class, sector, rating,
            market_cap_bucket, weight_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("2026-07-31", "555555", "INE000000555", "Cached Holding", None, None, None, None, 10.0),
    )
    conn.commit()
    return conn


def _dump_db(conn):
    tables = ("holdings", "mixes", "fundamentals", "filing_status", "schemes", "ingest_runs")
    dump = {}
    for table in tables:
        cur = conn.execute(f"SELECT * FROM {table}")
        cols = [desc[0] for desc in cur.description]
        rows = []
        for row in cur.fetchall():
            values = tuple(
                "<ts>" if col in {"attempted_at", "finished_at"} else "" if value is None else str(value)
                for col, value in zip(cols, row)
            )
            rows.append(values)
        dump[table] = sorted(rows)
    return dump


def _scrubbed_response(result):
    scrubbed = dict(result)
    scrubbed["filings"] = [
        {k: v for k, v in filing.items() if k not in {"attemptedAt", "finishedAt"}}
        for filing in result["filings"]
    ]
    return scrubbed


def test_ensure_parallel_matches_sequential_reference(tmp_path):
    # fresh, failing-without-history, stale-with-history, and fresh-with-history.
    codes = ["118741", "999999", "555555", "140084"]

    def fetch(code: str):
        if code in {"999999", "555555"}:
            raise FoliyoError("download-failed", "foliyo request failed")
        return PAYLOAD

    reference_conn = _seeded_db(tmp_path, "reference.sqlite")
    reference = _sequential_ensure(reference_conn, codes, month="2026-08", fetch=fetch)

    parallel_conn = _seeded_db(tmp_path, "parallel.sqlite")
    parallel = ensure_filings(parallel_conn, codes, month="2026-08", fetch=fetch)

    assert _scrubbed_response(parallel) == _scrubbed_response(reference)
    assert _dump_db(parallel_conn) == _dump_db(reference_conn)
    assert [f["state"] for f in parallel["filings"]] == [
        "fresh",
        "download-failed",
        "stale",
        "fresh",
    ]


def test_post_insights_does_not_call_ensure_filings(client, monkeypatch):
    called: list[object] = []
    monkeypatch.setattr(
        "app.main.ensure_filings",
        lambda *a, **k: called.append(True) or {"fetched": 0, "missing": [], "amcs": [], "filings": []},
    )

    res = client.post(
        "/api/insights",
        json={
            "baskets": [
                {
                    "id": "1",
                    "funds": [{"schemeCode": "no-such-scheme", "weight": 100}],
                }
            ]
        },
    )

    assert res.status_code == 200
    assert called == []
    basket = res.json()["baskets"][0]
    assert basket["filingCoverage"] == {"covered": 0, "total": 1}
