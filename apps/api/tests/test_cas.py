import copy
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from casparser.exceptions import CASParseError, IncorrectPasswordError

from app.ingest.cas import map_demat_statement, map_statement, write_statement


def demat_statement():
    return {
        "file_type": "CDSL",
        "statement_period": {"from": "01-Oct-2026", "to": "31-Oct-2026"},
        "accounts": [
            {"name": "Example DP CDSL Demat Account", "type": "CDSL Demat Account",
             "dp_id": "12000000", "client_id": "12345678",
             "equities": [{"name": "EXAMPLE CORP#EQUITY SHARES\x02", "isin": "INE000A01010",
                           "num_shares": "10.000", "price": "100.00", "value": "1000.00",
                           "symbol": "EXAMPLE", "exchange": "NSE"}],
             "mutual_funds": [{"name": "1234 - Example Flexi Cap Fund Direct Plan Growth",
                               "isin": "INF000000001", "amfi": "123456", "type": "EQUITY",
                               "balance": "50.500", "nav": "20.00", "value": "1010.00",
                               "total_cost": "1000.00", "folio": None}],
             "bonds": []},
            {"name": "Mutual Fund Folios", "type": "MF Folios", "dp_id": "", "client_id": "",
             "equities": [], "bonds": [],
             "mutual_funds": [
                 {"name": "D5678 - Example Small Cap Fund Direct Plan Growth",
                  "isin": "INF000000002", "amfi": "234567",
                  "balance": "100.000", "nav": "50.00", "value": "5000.00",
                  "total_cost": "4800.00", "folio": "12345678/90"},
                 {"name": "No Identifier Fund", "isin": None, "amfi": None,
                  "balance": "1.000", "value": "10.00"},
             ]},
        ],
    }


def test_demat_mapping():
    rows = map_demat_statement(demat_statement())
    assert rows["transactions"] == []
    assert rows["accounts"] == [
        ("cdsl:demat:1200000012345678", "cdsl", "Example DP CDSL Demat Account"),
        ("cdsl:folio:12345678/90", "cdsl", "MF folio 12345678/90"),
    ]
    assert rows["instruments"] == [
        ("isin:INE000A01010", "stock", "EXAMPLE CORP#EQUITY SHARES", "INE000A01010"),
        ("amfi:123456", "mf", "Example Flexi Cap Fund Direct Plan Growth", "INF000000001"),
        ("amfi:234567", "mf", "Example Small Cap Fund Direct Plan Growth", "INF000000002"),
    ]
    assert rows["snapshots"] == [
        ("2026-10-31", "cdsl:demat:1200000012345678", "isin:INE000A01010", 10.0, 1000.0),
        ("2026-10-31", "cdsl:demat:1200000012345678", "amfi:123456", 50.5, 1010.0),
        ("2026-10-31", "cdsl:folio:12345678/90", "amfi:234567", 100.0, 5000.0),
    ]
    assert rows["skipped"] == 1
    assert rows["statement_period"] == {"from": "01-Oct-2026", "to": "31-Oct-2026"}
    assert rows["replace_snapshots"] is True
    assert rows["replace_provider"] == "cdsl"
    assert rows["snapshot_date"] == "2026-10-31"
    assert map_demat_statement(demat_statement()) == rows


def test_demat_mapping_nsdl_and_fallbacks():
    data = demat_statement()
    data["file_type"] = "NSDL"
    data["accounts"][1]["mutual_funds"][0].pop("amfi")
    data["accounts"][1]["mutual_funds"][0].pop("folio")
    data["accounts"][1]["dp_id"] = "13000000"
    data["accounts"][1]["client_id"] = "87654321"
    rows = map_demat_statement(data)
    assert ("nsdl:demat:1300000087654321", "nsdl", "Mutual Fund Folios") in rows["accounts"]
    # ISIN-only MF holding falls back to the ISIN instrument and, without a
    # folio, to its depository account.
    assert ("isin:INF000000002", "mf", "Example Small Cap Fund Direct Plan Growth", "INF000000002") in rows["instruments"]
    assert ("2026-10-31", "nsdl:demat:1300000087654321", "isin:INF000000002", 100.0, 5000.0) in rows["snapshots"]
    assert rows["skipped"] == 1


def test_demat_mapping_rejects_missing_period():
    with pytest.raises(ValueError):
        map_demat_statement({"accounts": []})


@pytest.fixture
def statement():
    return json.loads((Path(__file__).parent / "fixtures" / "cas.json").read_text())


def test_mapping(statement):
    rows = map_statement(statement)
    assert rows["accounts"] == [
        ("cams:100001", "cams", "Example Mutual Fund · 100001"),
        ("kfintech:200002", "kfintech", "Sample Mutual Fund · 200002"),
    ]
    assert [r[0] for r in rows["instruments"]] == ["amfi:123456", "isin:INF000000002"]
    assert [r[4] for r in rows["transactions"]] == ["sip", "sip", "sell", "dividend", "buy", "switch-in", "switch-out"]
    assert rows["transactions"][2][5:] == (2, 210)
    assert rows["transactions"][3][5:] == (0, 20)
    assert rows["transactions"][0][0] != rows["transactions"][1][0]
    assert map_statement(copy.deepcopy(statement)) == rows
    assert rows["skipped"] == 2
    assert rows["snapshots"][0] == ("2024-03-31", "cams:100001", "amfi:123456", 18, 1980)


def test_reinvest_and_reversal_mapping():
    statement = {"statement_period": {}, "folios": [{"folio": "100001", "amc": "AMC", "rta": "CAMS", "amfi": "123456",
        "schemes": [{"scheme": "Fund", "isin": "INF000000001", "rta": "CAMS", "amfi": "123456", "close": 10,
            "valuation": {"date": "2024-06-30", "value": 1000},
            "transactions": [
                {"date": "2024-04-01", "type": "DIVIDEND_REINVEST", "amount": 30, "units": 1.5, "nav": 20},
                {"date": "2024-05-01", "type": "REVERSAL", "amount": 200, "units": -10, "nav": 20},
            ]}]}]}
    rows = map_statement(statement)
    assert [(r[4], r[5], r[6]) for r in rows["transactions"]] == [("dividend", 1.5, 30.0), ("sell", 10.0, 200.0)]
    assert rows["skipped"] == 0


def test_empty_mapping():
    rows = map_statement({"statement_period": {}, "folios": []})
    assert all(rows[key] == [] for key in ("accounts", "instruments", "transactions", "snapshots"))
    assert rows["skipped"] == 0


@pytest.mark.parametrize("field,value", [("rta", "unknown"), ("isin", None)])
def test_invalid_mapping(statement, field, value):
    scheme = statement["folios"][1]["schemes"][0]
    scheme[field] = value
    with pytest.raises(ValueError):
        map_statement(statement)


def test_import_endpoint(client, db, monkeypatch, statement):
    def parse(file, password, output):
        assert file.read() == b"synthetic pdf"
        assert password == "secret" and output == "dict"
        return statement
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", parse)
    def upload():
        return client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"synthetic pdf", "application/pdf")}, data={"password": "secret"})
    response = upload()
    assert response.status_code == 200
    assert response.json() == {
        "importId": hashlib.sha256(b"synthetic pdf").hexdigest(),
        "accountsInserted": 2, "instrumentsInserted": 2, "imported": 7,
        "duplicates": 0, "skipped": 2, "snapshotsWritten": 2,
        "statementPeriod": statement["statement_period"], "warnings": [],
    }
    again = upload().json()
    assert again["imported"] == again["accountsInserted"] == again["instrumentsInserted"] == 0
    assert again["duplicates"] == 7
    assert again["skipped"] == 2
    assert db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 7
    assert db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 2
    assert {r[0] for r in db.execute("SELECT import_id FROM transactions")} == {again["importId"]}


def test_non_cas_statement_rejected(client, db, monkeypatch):
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: {"unexpected": []})
    response = client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"nsdl pdf", "application/pdf")}, data={"password": "x"})
    assert response.status_code == 400


def test_demat_import_endpoint(client, db, monkeypatch):
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    def upload():
        return client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"demat pdf", "application/pdf")}, data={"password": "x"})
    response = upload()
    assert response.status_code == 200
    assert response.json() == {
        "importId": hashlib.sha256(b"demat pdf").hexdigest(),
        "accountsInserted": 2, "instrumentsInserted": 3, "imported": 0,
        "duplicates": 0, "skipped": 1, "snapshotsWritten": 3,
        "statementPeriod": {"from": "01-Oct-2026", "to": "31-Oct-2026"}, "warnings": [],
    }
    assert db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 3
    again = upload().json()
    assert again["accountsInserted"] == again["instrumentsInserted"] == 0
    assert again["snapshotsWritten"] == 3


def test_demat_reimport_drops_sold_holdings(client, db, monkeypatch):
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"oct", "application/pdf")}, data={"password": "x"})
    assert db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 3
    november = demat_statement()
    november["statement_period"] = {"from": "01-Nov-2026", "to": "30-Nov-2026"}
    november["accounts"][0]["equities"] = []
    november["accounts"][0]["mutual_funds"] = []
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: november)
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"nov", "application/pdf")}, data={"password": "x"})
    latest = latest_snapshots(db)
    assert latest == {
        ("cdsl:demat:1200000012345678", "isin:INE000A01010"): ("2026-11-30", 0.0),
        ("cdsl:demat:1200000012345678", "amfi:123456"): ("2026-11-30", 0.0),
        ("cdsl:folio:12345678/90", "amfi:234567"): ("2026-11-30", 100.0),
    }


def latest_snapshots(db):
    rows = db.execute(
        "SELECT s.account_id, s.instrument_id, s.date, s.units FROM snapshots s "
        "JOIN (SELECT account_id, instrument_id, MAX(date) AS d FROM snapshots "
        "      GROUP BY account_id, instrument_id) latest "
        "ON latest.account_id = s.account_id AND latest.instrument_id = s.instrument_id "
        "AND latest.d = s.date"
    )
    return {(row["account_id"], row["instrument_id"]): (row["date"], row["units"]) for row in rows}


def test_demat_redeemed_folio_stops_counting(client, db, monkeypatch):
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"oct", "application/pdf")}, data={"password": "x"})
    november = demat_statement()
    november["statement_period"] = {"from": "01-Nov-2026", "to": "30-Nov-2026"}
    november["accounts"][0]["equities"] = []
    november["accounts"][0]["mutual_funds"] = []
    november["accounts"][1]["mutual_funds"] = []
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: november)
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"nov", "application/pdf")}, data={"password": "x"})
    # The folio vanishes from the statement entirely, so no account row names
    # it; its last holding must still stop counting.
    row = db.execute(
        "SELECT date, units, value FROM snapshots WHERE account_id = 'cdsl:folio:12345678/90' "
        "AND instrument_id = 'amfi:234567'"
    ).fetchone()
    assert tuple(row) == ("2026-11-30", 0.0, 0.0)


def test_demat_empty_folios_summary_clears_holdings(client, db, monkeypatch):
    # Every folio redeemed: the statement still prints the (empty) Mutual
    # Fund Folios summary, so the parse has accounts but no holdings. That
    # is a real liquidation and must zero the saved snapshots, unlike a
    # parse that missed the accounts entirely.
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"oct", "application/pdf")}, data={"password": "x"})
    november = demat_statement()
    november["statement_period"] = {"from": "01-Nov-2026", "to": "30-Nov-2026"}
    november["accounts"][1]["mutual_funds"] = []
    november["accounts"] = [november["accounts"][1]]
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: november)
    response = client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"nov", "application/pdf")}, data={"password": "x"})
    assert response.status_code == 200
    assert latest_snapshots(db) == {
        ("cdsl:demat:1200000012345678", "isin:INE000A01010"): ("2026-11-30", 0.0),
        ("cdsl:demat:1200000012345678", "amfi:123456"): ("2026-11-30", 0.0),
        ("cdsl:folio:12345678/90", "amfi:234567"): ("2026-11-30", 0.0),
    }


def test_demat_older_reimport_keeps_newer_tombstones(client, db, monkeypatch):
    def upload(content):
        return client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", content, "application/pdf")}, data={"password": "x"})
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    upload(b"oct")
    november = demat_statement()
    november["statement_period"] = {"from": "01-Nov-2026", "to": "30-Nov-2026"}
    november["accounts"][0]["equities"] = []
    november["accounts"][0]["mutual_funds"] = []
    november["accounts"][1]["mutual_funds"] = []
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: november)
    upload(b"nov")
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    upload(b"oct-again")
    # Re-importing the older October statement must not resurrect holdings the
    # November statement already recorded as gone.
    assert latest_snapshots(db) == {
        ("cdsl:demat:1200000012345678", "isin:INE000A01010"): ("2026-11-30", 0.0),
        ("cdsl:demat:1200000012345678", "amfi:123456"): ("2026-11-30", 0.0),
        ("cdsl:folio:12345678/90", "amfi:234567"): ("2026-11-30", 0.0),
    }


def test_demat_replace_keeps_registrar_snapshots(client, db, monkeypatch, statement):
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: statement)
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"cas", "application/pdf")}, data={"password": "x"})
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"demat", "application/pdf")}, data={"password": "x"})
    rows = [tuple(r) for r in db.execute(
        "SELECT account_id, date FROM snapshots WHERE account_id IN ('cams:100001', 'kfintech:200002') ORDER BY account_id"
    )]
    assert rows == [("cams:100001", "2024-03-31"), ("kfintech:200002", "2024-03-31")]


def test_empty_demat_statement_rejected(client, db, monkeypatch):
    # A parse that misses every account must not be treated as a liquidation:
    # the import is refused and existing holdings stay untouched.
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"oct", "application/pdf")}, data={"password": "x"})
    before = latest_snapshots(db)
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf",
                        lambda *args, **kwargs: {"file_type": "NSDL", "statement_period": {"from": "01-Oct-2026", "to": "31-Oct-2026"}, "accounts": []})
    response = client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"empty", "application/pdf")}, data={"password": "x"})
    assert response.status_code == 400
    assert latest_snapshots(db) == before


def test_demat_unreadable_holdings_rejected(client, db, monkeypatch):
    # Holdings that parse but map to no account or instrument are a degraded
    # parse, not a liquidation: the import is refused and snapshots stay put.
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: demat_statement())
    client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"oct", "application/pdf")}, data={"password": "x"})
    before = latest_snapshots(db)
    broken = {"file_type": "CDSL", "statement_period": {"from": "01-Nov-2026", "to": "30-Nov-2026"},
              "accounts": [{"name": "Mutual Fund Folios",
                            "mutual_funds": [{"name": "Opaque Fund", "balance": "1.0", "value": "10.0"}]}]}
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: broken)
    response = client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"nov", "application/pdf")}, data={"password": "x"})
    assert response.status_code == 400
    assert latest_snapshots(db) == before


@pytest.mark.parametrize("error,detail", [(IncorrectPasswordError("bad"), "password"), (CASParseError("bad"), "parse")])
def test_parser_errors(client, db, monkeypatch, error, detail):
    def parse(*args, **kwargs):
        raise error
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", parse)
    response = client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"bad")}, data={"password": "wrong"})
    assert response.status_code == 400
    assert detail in response.json()["detail"]
    assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


def test_real_garbage(client):
    response = client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"garbage")}, data={"password": "wrong"})
    assert response.status_code == 400


def test_atomic_write(db, statement):
    rows = map_statement(statement)
    rows["snapshots"][0] = ("2024-03-31", "missing-account", "amfi:123456", 1, 1)
    with pytest.raises(sqlite3.IntegrityError):
        write_statement(db, rows, "test")
    assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


def test_snapshot_upsert(db, statement):
    rows = map_statement(statement)
    write_statement(db, rows, "first")
    statement["folios"][0]["schemes"][0]["valuation"]["value"] = "2000"
    write_statement(db, map_statement(statement), "second")
    assert db.execute("SELECT value FROM snapshots WHERE account_id='cams:100001'").fetchone()[0] == 2000


def test_import_rejects_oversized_upload(client, monkeypatch):
    monkeypatch.setattr("app.cas_routes.CAS_MAX_BYTES", 4)
    response = client.post("/api/portfolio/import/cas",
                           files={"file": ("cas.pdf", b"12345", "application/pdf")},
                           data={"password": "secret"})
    assert response.status_code == 413
