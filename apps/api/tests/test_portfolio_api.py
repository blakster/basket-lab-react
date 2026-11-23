import json
from pathlib import Path

import pytest

from app.ingest.cas import map_statement, write_statement
from app.ingest.scheme_master import SchemeMaster
from app.main import app

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
    assert set(first) == {"id", "accountId", "instrumentId", "date", "kind", "units", "amount"}
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
