from app.filing_status import FilingStatus, filing_statuses, record_filing_status


def test_filing_status_round_trips_source_and_reason(db):
    record_filing_status(
        db,
        FilingStatus(
            scheme_code="118741",
            state="download-failed",
            requested_month="2026-08",
            attempted_at="2026-08-16T00:00:00+00:00",
            finished_at="2026-08-16T00:00:01+00:00",
            as_of=None,
            amc="Nippon India Mutual Fund",
            source_url="https://amc.example/portfolio.xls",
            reason="connection timed out",
        ),
    )

    result = filing_statuses(db, ["118741"], "2026-08")

    assert result["118741"].reason == "connection timed out"
    assert result["118741"].source_url == "https://amc.example/portfolio.xls"


def test_existing_holdings_are_stale_not_missing_when_month_is_newer(db):
    db.execute(
        """
        INSERT INTO holdings (
            as_of, scheme_code, isin, instrument_name, asset_class, sector, rating,
            market_cap_bucket, weight_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("2026-07-31", "118741", "INE000000001", "Example Holding", None, None, None, None, 10.0),
    )
    db.commit()

    result = filing_statuses(db, ["118741"], "2026-08")

    assert result["118741"].state == "stale"
