from datetime import date

import app.portfolio_commission as commission
from app.ingest.scheme_master import SchemeMaster
from app.main import app
from app.portfolio_commission import ExpenseRatio

MASTER_CSV = """scheme_code,scheme_name,isin,scheme_plan,scheme_option,is_active
2001,Example Flexi Fund - Direct Plan - Growth,INF0000000D1,Direct,Growth,true
2002,Example Flexi Fund - Regular Plan - Growth,INF0000000R1,Regular,Growth,true
3001,Example Income Fund - Direct Plan - IDCW,INF0000000D2,Direct,IDCW,true
"""


def install_master():
    app.state.scheme_master = SchemeMaster.from_csv_text(MASTER_CSV)


def add_instrument(db, instrument_id, name, kind="mf", isin=None):
    db.execute(
        "INSERT INTO instruments (id, kind, name, isin) VALUES (?, ?, ?, ?)",
        (instrument_id, kind, name, isin),
    )


def fake_expenses(values):
    calls = []
    as_of = date.today().isoformat()

    def fetch(code):
        calls.append(code)
        value = values.get(code)
        return None if value is None else ExpenseRatio(value, as_of)

    return fetch, calls


def test_fetch_expense_ratio_reads_only_the_overview(monkeypatch):
    calls = []

    def fake_call(name, arguments):
        calls.append((name, arguments))
        return {
            "overview": {
                "expense_ratio_pct": 1.3,
                "expense_ratio_as_of": "2026-10-31",
            }
        }

    monkeypatch.setattr(commission, "call_foliyo_tool", fake_call)

    assert commission.fetch_expense_ratio("2002") == ExpenseRatio(1.3, "2026-10-31")
    assert calls == [
        (
            "get_fund_details",
            {"fund": "2002", "sections": ["overview"], "holdings_limit": 1},
        )
    ]


def test_commission_check_matches_direct_and_fetches_current_expense_ratios(client, db, monkeypatch):
    install_master()
    add_instrument(
        db,
        "amfi:2002",
        "Example Flexi Fund - Regular Plan - Growth",
        isin="INF0000000R1",
    )
    fetch, calls = fake_expenses({"2002": 1.25, "2001": 0.64})
    monkeypatch.setattr(commission, "fetch_expense_ratio", fetch)
    as_of = date.today().isoformat()

    response = client.post(
        "/api/portfolio/commission-check", json={"instrumentIds": ["amfi:2002"]}
    )

    assert response.status_code == 200
    assert response.json()["rows"] == [
        {
            "instrumentId": "amfi:2002",
            "schemeCode": "2002",
            "schemeName": "Example Flexi Fund - Regular Plan - Growth",
            "directSchemeCode": "2001",
            "directSchemeName": "Example Flexi Fund - Direct Plan - Growth",
            "status": "ready",
            "regularExpenseRatio": 1.25,
            "directExpenseRatio": 0.64,
            "expenseGapPct": 0.61,
            "regularExpenseRatioAsOf": as_of,
            "directExpenseRatioAsOf": as_of,
        }
    ]
    assert sorted(calls) == ["2001", "2002"]

    calls.clear()
    again = client.post(
        "/api/portfolio/commission-check", json={"instrumentIds": ["amfi:2002"]}
    )
    assert again.status_code == 200
    assert again.json()["rows"][0]["expenseGapPct"] == 0.61
    assert sorted(calls) == ["2001", "2002"]


def test_commission_check_ignores_direct_plans_and_non_mutual_funds(client, db, monkeypatch):
    install_master()
    add_instrument(db, "amfi:2001", "Example Flexi Fund - Direct Plan - Growth")
    add_instrument(db, "isin:INE000000001", "Regularly Traded Stock", kind="stock")
    fetch, calls = fake_expenses({})
    monkeypatch.setattr(commission, "fetch_expense_ratio", fetch)

    response = client.post(
        "/api/portfolio/commission-check",
        json={"instrumentIds": ["amfi:2001", "isin:INE000000001"]},
    )

    assert response.status_code == 200
    assert response.json() == {"rows": []}
    assert calls == []


def test_commission_check_flags_unmatched_regular_plan_without_fetching(client, db, monkeypatch):
    install_master()
    add_instrument(db, "amfi:999999", "Unknown Flexi Fund - Regular Plan - Growth")
    fetch, calls = fake_expenses({})
    monkeypatch.setattr(commission, "fetch_expense_ratio", fetch)

    response = client.post(
        "/api/portfolio/commission-check", json={"instrumentIds": ["amfi:999999"]}
    )

    assert response.status_code == 200
    assert response.json()["rows"] == [
        {
            "instrumentId": "amfi:999999",
            "schemeCode": "999999",
            "schemeName": "Unknown Flexi Fund - Regular Plan - Growth",
            "directSchemeCode": None,
            "directSchemeName": None,
            "status": "missing-direct-plan",
        }
    ]
    assert calls == []


def test_commission_check_marks_missing_expense_without_inventing_zero(client, db, monkeypatch):
    install_master()
    add_instrument(db, "amfi:2002", "Example Flexi Fund - Regular Plan - Growth")
    fetch, _calls = fake_expenses({"2002": 1.25, "2001": None})
    monkeypatch.setattr(commission, "fetch_expense_ratio", fetch)

    response = client.post(
        "/api/portfolio/commission-check", json={"instrumentIds": ["amfi:2002"]}
    )

    assert response.status_code == 200
    row = response.json()["rows"][0]
    assert row["status"] == "missing-expense-ratio"
    assert "regularExpenseRatio" not in row
    assert "directExpenseRatio" not in row


def test_scheme_master_plan_metadata_wins_over_a_stale_imported_name(client, db, monkeypatch):
    install_master()
    add_instrument(db, "amfi:2001", "Example Flexi Fund - Regular Plan - Growth")
    fetch, calls = fake_expenses({})
    monkeypatch.setattr(commission, "fetch_expense_ratio", fetch)

    response = client.post(
        "/api/portfolio/commission-check", json={"instrumentIds": ["amfi:2001"]}
    )

    assert response.status_code == 200
    assert response.json() == {"rows": []}
    assert calls == []


def test_commission_check_treats_unlabeled_legacy_plan_as_regular_when_direct_exists(
    client, db, monkeypatch
):
    app.state.scheme_master = SchemeMaster.from_csv_text(
        "scheme_code,scheme_name,isin,scheme_plan,scheme_option,is_active\n"
        "5001,Example Advantage Fund - Growth Plan - Direct Plan,INF0000000D3,Direct,Growth,true\n"
        "5002,Example Advantage Fund - Growth Plan,INF0000000R3,Other,Growth,true\n"
    )
    add_instrument(db, "amfi:5002", "Example Advantage Fund - Growth Plan")
    fetch, _calls = fake_expenses({"5002": 1.4, "5001": 0.7})
    monkeypatch.setattr(commission, "fetch_expense_ratio", fetch)

    response = client.post(
        "/api/portfolio/commission-check", json={"instrumentIds": ["amfi:5002"]}
    )

    assert response.status_code == 200
    row = response.json()["rows"][0]
    assert row["status"] == "ready"
    assert row["directSchemeCode"] == "5001"


def test_commission_check_resolves_a_secondary_isin(client, db, monkeypatch):
    app.state.scheme_master = SchemeMaster.from_csv_text(
        "scheme_code,scheme_name,isin,isin2,scheme_plan,scheme_option,is_active\n"
        "6001,Example Secondary Fund - Direct Plan - Growth,INF0000000D4,,Direct,Growth,true\n"
        "6002,Example Secondary Fund - Regular Plan - Growth,INF0000000R4,INF0000000R5,Regular,Growth,true\n"
    )
    add_instrument(
        db,
        "isin:INF0000000R5",
        "Example Secondary Fund - Regular Plan - Growth",
        isin="INF0000000R5",
    )
    fetch, _calls = fake_expenses({"6002": 1.4, "6001": 0.7})
    monkeypatch.setattr(commission, "fetch_expense_ratio", fetch)

    response = client.post(
        "/api/portfolio/commission-check", json={"instrumentIds": ["isin:INF0000000R5"]}
    )

    assert response.status_code == 200
    row = response.json()["rows"][0]
    assert row["schemeCode"] == "6002"
    assert row["directSchemeCode"] == "6001"


def test_commission_check_validates_instrument_ids(client):
    assert client.post("/api/portfolio/commission-check", json={}).status_code == 422
    assert (
        client.post(
            "/api/portfolio/commission-check",
            json={"instrumentIds": ["x"] * 201},
        ).status_code
        == 422
    )


def test_direct_counterpart_preserves_payout_and_reinvestment_options():
    master = SchemeMaster.from_csv_text(
        "scheme_code,scheme_name,isin,scheme_plan,scheme_option,is_active\n"
        "4001,Income Fund - Direct Plan - Payout of Income Distribution cum capital withdrawal option,,Direct,IDCW,true\n"
        "4002,Income Fund - Regular Plan - Payout of Income Distribution cum capital withdrawal option,,Regular,IDCW,true\n"
        "4003,Income Fund - Direct Plan - Reinvestment of Income Distribution cum capital withdrawal option,,Direct,IDCW,true\n"
        "4004,Income Fund - Regular Plan - Reinvestment of Income Distribution cum capital withdrawal option,,Regular,IDCW,true\n"
    )

    assert master.direct_counterpart("4002").scheme_code == "4001"
    assert master.direct_counterpart("4004").scheme_code == "4003"


def test_fetch_expense_ratio_rejects_non_finite_values(monkeypatch):
    monkeypatch.setattr(
        commission,
        "call_foliyo_tool",
        lambda _name, _arguments: {
            "overview": {
                "expense_ratio_pct": float("inf"),
                "expense_ratio_as_of": "2026-10-31",
            }
        },
    )

    assert commission.fetch_expense_ratio("2002") is None


def test_commission_check_isolates_a_fetcher_failure(client, db, monkeypatch):
    install_master()
    add_instrument(db, "amfi:2002", "Example Flexi Fund - Regular Plan - Growth")

    def fetch(code):
        if code == "2001":
            raise RuntimeError("Foliyo unavailable")
        return ExpenseRatio(1.25, date.today().isoformat())

    monkeypatch.setattr(commission, "fetch_expense_ratio", fetch)

    response = client.post(
        "/api/portfolio/commission-check", json={"instrumentIds": ["amfi:2002"]}
    )

    assert response.status_code == 200
    row = response.json()["rows"][0]
    assert row["status"] == "missing-expense-ratio"
    assert row["schemeCode"] == "2002"


def test_commission_check_requires_json_content_type(client):
    response = client.post(
        "/api/portfolio/commission-check",
        content='{"instrumentIds": []}',
        headers={"Content-Type": "text/plain"},
    )

    assert response.status_code == 415


def test_scheme_master_preserves_typed_inactive_rows():
    master = SchemeMaster.from_rows(
        [
            {
                "scheme_code": "7001",
                "scheme_name": "Example Fund - Direct Plan - Growth",
                "is_active": False,
            }
        ]
    )

    assert master.by_code("7001").is_active is False


def test_direct_counterpart_preserves_regular_inside_a_fund_name():
    master = SchemeMaster.from_csv_text(
        "scheme_code,scheme_name,isin,amc,scheme_plan,scheme_option,is_active\n"
        "123183,ICICI Prudential Regular Savings Fund - Direct Plan - Bonus,,ICICI Prudential Mutual Fund,Direct,Bonus,true\n"
        "128110,ICICI Prudential Regular Savings Fund - Plan - Bonus,,ICICI Prudential Mutual Fund,Regular,Bonus,true\n"
        "130900,ICICI Prudential Savings Fund - Bonus,,ICICI Prudential Mutual Fund,Other,Bonus,true\n"
        "130952,ICICI Prudential Savings Fund - Direct Plan Bonus,,ICICI Prudential Mutual Fund,Direct,Bonus,true\n"
    )

    assert master.direct_counterpart("128110").scheme_code == "123183"
    assert master.direct_counterpart("130900").scheme_code == "130952"


def test_direct_counterpart_requires_the_same_amc():
    master = SchemeMaster.from_csv_text(
        "scheme_code,scheme_name,isin,amc,scheme_plan,scheme_option,is_active\n"
        "8001,Income Fund - Direct Plan - Growth,,First Mutual Fund,Direct,Growth,true\n"
        "8002,Income Fund - Regular Plan - Growth,,Second Mutual Fund,Regular,Growth,true\n"
    )

    assert master.direct_counterpart("8002") is None


def test_direct_counterpart_rejects_ambiguous_direct_matches():
    master = SchemeMaster.from_csv_text(
        "scheme_code,scheme_name,isin,amc,scheme_plan,scheme_option,is_active\n"
        "9001,Income Fund - Direct Plan - Growth,,Example Mutual Fund,Direct,Growth,true\n"
        "9002,Income Fund Direct Plan Growth,,Example Mutual Fund,Direct,Growth,true\n"
        "9003,Income Fund - Regular Plan - Growth,,Example Mutual Fund,Regular,Growth,true\n"
    )

    assert master.direct_counterpart("9003") is None


def test_isin_lookup_uses_the_instrument_name_to_keep_merged_fund_history():
    master = SchemeMaster.from_csv_text(
        "scheme_code,scheme_name,isin,scheme_plan,scheme_option,is_active\n"
        "100153,Principal Nifty 100 Equal Weight Fund-Growth,INF173K01AG2,Other,Growth,false\n"
        "149481,Sundaram Nifty 100 Equal Weight Fund (Formerly Known as Principal Nifty 100 Equal Weight Fund)-Growth,INF173K01AG2,Other,Growth,true\n"
    )

    assert (
        master.lookup(
            scheme_isin="INF173K01AG2",
            scheme_name="Principal Nifty 100 Equal Weight Fund-Growth",
        )
        == "100153"
    )
    assert master.lookup(scheme_isin="INF173K01AG2") == "149481"
