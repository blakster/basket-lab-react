import json
from pathlib import Path

import pytest

from app.ingest.cas import map_statement, write_statement
from app.ingest.scheme_master import SchemeMaster
from app.main import app
from app.portfolio import add_manual_transaction

CAS_JSON = Path(__file__).parent / "fixtures" / "cas.json"


@pytest.fixture
def statement():
    return json.loads(CAS_JSON.read_text())


@pytest.fixture(autouse=True)
def no_network_master():
    # ISIN lookups stay empty unless a test installs a master; no downloads in tests.
    app.state.scheme_master = SchemeMaster([])


def test_portfolio_read(client, db, statement):
    write_statement(db, map_statement(statement), "seed")
    response = client.get("/api/portfolio")
    assert response.status_code == 200
    body = response.json()
    assert [a["id"] for a in body["accounts"]] == ["cams:100001", "kfintech:200002"]
    assert body["accounts"][0]["provider"] == "cams"
    instruments = {i["id"]: i for i in body["instruments"]}
    assert instruments["amfi:123456"]["schemeCode"] == "123456"
    assert instruments["amfi:123456"]["kind"] == "mf"
    assert instruments["isin:INF000000002"]["schemeCode"] is None
    kinds = sorted(t["kind"] for t in body["transactions"])
    assert kinds == ["buy", "dividend", "sell", "sip", "sip", "switch-in", "switch-out"]
    first = body["transactions"][0]
    assert first["accountId"] in {"cams:100001", "kfintech:200002"}
    assert first["instrumentId"] in {"amfi:123456", "isin:INF000000002"}
    assert first["date"] <= body["transactions"][-1]["date"]
    assert set(first) == {"id", "accountId", "instrumentId", "date", "kind", "units", "amount", "manual"}
    assert first["manual"] is False
    # Latest snapshot per account + instrument only.
    assert len(body["snapshots"]) == 2
    assert {s["accountId"] for s in body["snapshots"]} == {"cams:100001", "kfintech:200002"}


def test_portfolio_empty(client):
    body = client.get("/api/portfolio").json()
    assert body == {"accounts": [], "instruments": [], "transactions": [], "snapshots": []}


def test_portfolio_isin_resolution(client, db):
    db.execute("INSERT INTO accounts VALUES ('cams:1', 'cams', 'Fund · 1')")
    db.execute(
        "INSERT INTO instruments (id, kind, name, isin) VALUES "
        "('isin:INF179K01319', 'mf', 'HDFC Arbitrage', 'INF179K01319')"
    )
    app.state.scheme_master = SchemeMaster.from_csv_text(
        "scheme_code,scheme_name,isin\n106796,HDFC Arbitrage,INF179K01319\n"
    )
    body = client.get("/api/portfolio").json()
    assert body["instruments"][0]["schemeCode"] == "106796"


def _manual_body(**overrides):
    body = {
        "scheme": {"schemeCode": "123456", "name": "Example Equity Direct Growth", "isin": None},
        "date": "2024-05-01",
        "kind": "buy",
        "units": 10.5,
        "amount": 1234.5,
    }
    body.update(overrides)
    return body


def test_manual_transaction_create(client):
    response = client.post("/api/portfolio/transactions", json=_manual_body())
    assert response.status_code == 200
    tx = response.json()
    assert tx["manual"] is True
    assert tx["accountId"] == "manual:entry"
    assert tx["instrumentId"] == "amfi:123456"
    body = client.get("/api/portfolio").json()
    assert [a["id"] for a in body["accounts"]] == ["manual:entry"]
    assert body["instruments"] == [
        {"id": "amfi:123456", "kind": "mf", "name": "Example Equity Direct Growth",
         "isin": None, "schemeCode": "123456"}
    ]
    assert body["transactions"] == [tx]
    # A second, different transaction on the same fund is allowed.
    other = client.post("/api/portfolio/transactions",
                        json=_manual_body(units=2, amount=200)).json()
    assert other["id"] != tx["id"]


def test_manual_transaction_existing_instrument(client, db, statement):
    write_statement(db, map_statement(statement), "seed")
    response = client.post(
        "/api/portfolio/transactions",
        json=_manual_body(instrumentId="amfi:123456", scheme=None),
    )
    assert response.status_code == 200
    assert response.json()["instrumentId"] == "amfi:123456"


@pytest.mark.parametrize(
    "overrides",
    [
        {"kind": "dividend"},
        {"kind": "switch-in"},
        {"date": "2024-13-40"},
        {"date": "2999-01-01"},
        {"units": 0},
        {"units": -3},
        {"units": "abc"},
        {"amount": 0},
        {"scheme": {"schemeCode": ""}},
    ],
)
def test_manual_transaction_validation(client, overrides):
    response = client.post("/api/portfolio/transactions", json=_manual_body(**overrides))
    assert response.status_code == 422
    assert client.get("/api/portfolio").json()["transactions"] == []


def test_manual_duplicate_blocked(client):
    first = client.post("/api/portfolio/transactions", json=_manual_body())
    assert first.status_code == 200
    again = client.post("/api/portfolio/transactions", json=_manual_body())
    assert again.status_code == 409
    assert "already in your portfolio" in again.json()["detail"]
    # Slightly different amount is a different transaction.
    changed = client.post("/api/portfolio/transactions", json=_manual_body(amount=1234.51))
    assert changed.status_code == 200


def test_manual_matches_imported_statement(client, statement):
    write_statement(client.app.state.db, map_statement(statement), "seed")
    # The fixture's first SIP: amfi:123456, 2024-01-01, 10 units, 1000. A hand
    # entry of the same movement (as a buy) must be refused.
    response = client.post(
        "/api/portfolio/transactions",
        json=_manual_body(kind="buy", units=10, amount=1000, date="2024-01-01",
                          instrumentId="amfi:123456", scheme=None),
    )
    assert response.status_code == 409


def _statement_with_transactions(transactions, amfi="123456", isin="INF000000001"):
    scheme = {"scheme": "Fund", "isin": isin, "rta": "CAMS",
              "close": 100, "valuation": {"date": "2024-06-30", "value": 1000},
              "transactions": transactions}
    if amfi is not None:
        scheme["amfi"] = amfi
    return {"statement_period": {}, "folios": [
        {"folio": "100001", "amc": "AMC", "rta": "CAMS", "schemes": [scheme]}]}


def test_cas_import_replaces_manual_duplicates(db):
    one = _statement_with_transactions([
        {"date": "2024-04-01", "type": "PURCHASE", "units": "5", "amount": "500"},
        {"date": "2024-05-01", "type": "PURCHASE", "units": "5", "amount": "500"},
    ])
    # Hand-enter the first purchase before the statement arrives.
    add_manual_transaction(db, _manual_body(date="2024-04-01", units=5, amount=500))
    result = write_statement(db, map_statement(one), "cas-1")
    # The statement supersedes the hand-entered copy of the first purchase;
    # the second, unentered purchase imports normally.
    assert result["imported"] == 2
    assert result["duplicates"] == 0
    rows = db.execute("SELECT import_id FROM transactions").fetchall()
    assert len(rows) == 2
    assert all(row["import_id"] == "cas-1" for row in rows)


def test_cas_import_keeps_repeated_statement_rows(db):
    one = _statement_with_transactions([
        {"date": "2024-04-01", "type": "PURCHASE", "units": "5", "amount": "500"},
        {"date": "2024-04-01", "type": "PURCHASE", "units": "5", "amount": "500"},
    ])
    add_manual_transaction(db, _manual_body(date="2024-04-01", units=5, amount=500))
    result = write_statement(db, map_statement(one), "cas-1")
    # One hand-entered copy is replaced by the first statement row; the second
    # identical statement row is a separate purchase and must still import.
    assert result["imported"] == 2
    assert db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 2


def test_cas_isin_only_statement_replaces_manual(db):
    add_manual_transaction(db, _manual_body(
        scheme={"schemeCode": "123456", "name": "Fund", "isin": "INF000000001"},
        date="2024-04-01", units=5, amount=500))
    # No AMFI code: the statement identifies the fund by ISIN only.
    one = _statement_with_transactions(
        [{"date": "2024-04-01", "type": "PURCHASE", "units": "5", "amount": "500"}],
        amfi=None)
    result = write_statement(db, map_statement(one), "cas-1")
    assert result["imported"] == 1
    rows = db.execute("SELECT instrument_id, import_id FROM transactions").fetchall()
    assert len(rows) == 1
    assert rows[0]["instrument_id"] == "isin:INF000000001"
    assert rows[0]["import_id"] == "cas-1"


def test_manual_reuses_instrument_by_isin(db):
    db.execute(
        "INSERT INTO instruments (id, kind, name, isin) VALUES "
        "('isin:INF000000009', 'mf', 'Statement Fund', 'INF000000009')")
    tx = add_manual_transaction(db, _manual_body(
        scheme={"schemeCode": "999999", "name": "Statement Fund", "isin": "inf000000009"}))
    assert tx["instrumentId"] == "isin:INF000000009"


def test_manual_transaction_requires_json(client):
    response = client.post(
        "/api/portfolio/transactions",
        content="{}",
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 415


def test_delete_manual_transaction(client, statement):
    write_statement(client.app.state.db, map_statement(statement), "seed")
    created = client.post("/api/portfolio/transactions", json=_manual_body()).json()
    imported_id = client.get("/api/portfolio").json()["transactions"][0]["id"]
    assert client.delete(f"/api/portfolio/transactions/{imported_id}").status_code == 400
    assert client.delete(f"/api/portfolio/transactions/{created['id']}").status_code == 200
    assert client.delete(f"/api/portfolio/transactions/{created['id']}").status_code == 404
    assert client.delete("/api/portfolio/transactions/manual:missing").status_code == 404
