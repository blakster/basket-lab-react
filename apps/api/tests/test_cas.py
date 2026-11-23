import copy
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from casparser.exceptions import CASParseError, IncorrectPasswordError

from app.ingest.cas import map_statement, write_statement


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
    monkeypatch.setattr("app.ingest.cas.casparser.read_cas_pdf", lambda *args, **kwargs: {"accounts": []})
    response = client.post("/api/portfolio/import/cas", files={"file": ("cas.pdf", b"nsdl pdf", "application/pdf")}, data={"password": "x"})
    assert response.status_code == 400


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
