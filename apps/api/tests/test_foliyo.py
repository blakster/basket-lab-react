from app.ingest.foliyo import FoliyoError, persist_fund_details, rpc_result

PAYLOAD = {
    "source": "Foliyo · end-of-day market data",
    "id": "mf:F00000PZH2",
    "name": "Parag Parikh Flexi Cap Fund - Direct Growth",
    "url": "https://foliyo.ai/mutual-funds/?isin=INF879O01027",
    "overview": {
        "fund_house": "PPFAS Asset Management Pvt. Ltd",
        "expense_ratio_pct": 0.69,
        "aum_cr": 145070,
        "aum_as_of": "2026-09-30",
    },
    "holdings": {
        "as_of": "2026-09-30",
        "items": [
            {"name": "HDFC Bank Ltd", "weight_pct": 7.75, "sector": "Financial Services"},
            {"name": "ITC Ltd", "weight_pct": 5.49, "sector": "Consumer Defensive"},
        ],
    },
    "asset_allocation": {
        "as_of": "2026-09-30",
        "by_asset": [
            {"name": "Equity", "weight_pct": 90.23},
            {"name": "Cash & equivalents", "weight_pct": 9.56},
            {"name": "Debt", "weight_pct": 0.21},
        ],
        "market_cap": [
            {"name": "Large cap", "weight_pct": 65.25},
            {"name": "Mid cap", "weight_pct": 8.32},
            {"name": "Small cap", "weight_pct": 5.76},
        ],
    },
    "sector_allocation": {
        "as_of": "2026-09-30",
        "items": [
            {"name": "Financial Services", "weight_pct": 26.71},
            {"name": "Technology", "weight_pct": 11.87},
        ],
    },
    "portfolio_stats": {
        "as_of": "2026-09-30",
        "pe": 17.56,
        "credit_quality": [{"name": "AAA", "weight_pct": 100}],
    },
}


def test_rpc_result_reads_sse():
    body = (
        "event: message\n"
        'data: {"result":{"structuredContent":{"id":"mf:x","name":"X"}},"jsonrpc":"2.0","id":1}\n'
    )
    assert rpc_result(body)["id"] == "mf:x"


def test_rpc_unknown_instrument_is_unmapped():
    body = (
        '{"result":{"isError":true,"content":[{"type":"text",'
        '"text":"Unknown instrument \'000000\'. Closest: mf:F000000I3Z"}]},'
        '"jsonrpc":"2.0","id":3}'
    )
    try:
        rpc_result(body)
    except FoliyoError as exc:
        assert exc.failure == "unmapped"
    else:
        raise AssertionError("expected FoliyoError")


def test_persist_writes_holdings_mixes_and_fundamentals(db):
    saved = persist_fund_details(db, "122639", PAYLOAD)
    assert saved.as_of == "2026-09-30"
    assert saved.amc == "PPFAS Asset Management Pvt. Ltd"
    holding = db.execute(
        "SELECT instrument_name, isin, weight_pct, sector FROM holdings WHERE scheme_code='122639' AND as_of='2026-09-30' ORDER BY weight_pct DESC"
    ).fetchone()
    assert holding["instrument_name"] == "HDFC Bank Ltd"
    assert holding["isin"] is None
    assert float(holding["weight_pct"]) == 7.75
    assert holding["sector"] == "Financial Services"
    funda = db.execute(
        "SELECT pe, expense_ratio, aum_cr, turnover FROM fundamentals WHERE scheme_code='122639'"
    ).fetchone()
    assert float(funda["pe"]) == 17.56
    assert float(funda["expense_ratio"]) == 0.69
    assert float(funda["aum_cr"]) == 145070
    assert funda["turnover"] is None
    equity = db.execute(
        "SELECT weight_pct FROM mixes WHERE scheme_code='122639' AND kind='asset' AND label='equity'"
    ).fetchone()
    assert float(equity["weight_pct"]) == 90.23
    credit = db.execute(
        "SELECT weight_pct FROM mixes WHERE scheme_code='122639' AND kind='credit' AND label='AAA'"
    ).fetchone()
    assert abs(float(credit["weight_pct"]) - 0.21) < 1e-9
