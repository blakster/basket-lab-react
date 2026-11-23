"""CAMS/KFin CAS mapping. Amounts and units are magnitudes; kind carries direction."""

import hashlib
import json
from collections import Counter
from datetime import date
from decimal import Decimal
from io import BytesIO

import casparser
from casparser.exceptions import IncorrectPasswordError
from fastapi import HTTPException


KINDS = {
    "PURCHASE": "buy", "PURCHASE_SIP": "sip", "REDEMPTION": "sell",
    "SWITCH_IN": "switch-in", "SWITCH_IN_MERGER": "switch-in",
    "SWITCH_OUT": "switch-out", "SWITCH_OUT_MERGER": "switch-out",
    "DIVIDEND_PAYOUT": "dividend", "DIVIDEND_REINVESTMENT": "dividend",
}


def _number(value):
    number = abs(Decimal(str(value)))
    if not number.is_finite():
        raise ValueError("Non-finite number in statement")
    return number


def _date(value):
    return date.fromisoformat(str(value)).isoformat()


def map_statement(data):
    """Map a casparser dict without I/O; identical rows retain occurrence identities."""
    period = data["statement_period"]
    accounts, instruments, transactions, snapshots = {}, {}, [], {}
    occurrences = Counter()
    skipped = 0
    for folio in data["folios"]:
        for scheme in folio["schemes"]:
            provider = scheme["rta"].lower().strip()
            if provider not in {"cams", "kfintech"}:
                raise ValueError("Unsupported CAS registrar")
            account = f'{provider}:{folio["folio"]}'
            accounts[account] = (account, provider, f'{folio["amc"]} · {folio["folio"]}')
            if scheme.get("amfi"):
                instrument = f'amfi:{scheme["amfi"]}'
            elif scheme.get("isin"):
                instrument = f'isin:{scheme["isin"]}'
            else:
                raise ValueError("Scheme has neither AMFI code nor ISIN")
            instruments[instrument] = (instrument, "mf", scheme["scheme"], scheme.get("isin"))
            for txn in scheme["transactions"]:
                kind = KINDS.get(txn["type"])
                if kind is None or txn.get("amount") is None:
                    skipped += 1
                    continue
                units = _number(txn["units"] if txn.get("units") is not None else 0)
                amount = _number(txn["amount"])
                day = _date(txn["date"])
                key = (account, instrument, day, kind, str(units.normalize()), str(amount.normalize()))
                index = occurrences[key]
                occurrences[key] += 1
                identity = hashlib.sha256(json.dumps((*key, index)).encode()).hexdigest()
                transactions.append((identity, account, instrument, day, kind, float(units), float(amount)))
            valuation = scheme["valuation"]
            day = _date(valuation["date"])
            snapshots[(day, account, instrument)] = (
                day, account, instrument, float(_number(scheme["close"])), float(_number(valuation["value"]))
            )
    return {"accounts": list(accounts.values()), "instruments": list(instruments.values()),
            "transactions": transactions, "snapshots": list(snapshots.values()),
            "skipped": skipped, "statement_period": period}


def write_statement(conn, rows, import_id):
    counts = {}
    with conn:
        for table, columns in (("accounts", "id,provider,label"), ("instruments", "id,kind,name,isin")):
            inserted = 0
            for row in rows[table]:
                cursor = conn.execute(
                    f'INSERT OR IGNORE INTO {table} ({columns}) VALUES ({",".join("?" for _ in row)})', row
                )
                inserted += cursor.rowcount
            counts[f"{table}Inserted"] = inserted
        inserted = 0
        for row in rows["transactions"]:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO transactions "
                "(id,account_id,instrument_id,date,kind,units,amount,import_id) VALUES (?,?,?,?,?,?,?,?)",
                (*row, import_id),
            )
            inserted += cursor.rowcount
        conn.executemany(
            "INSERT INTO snapshots (date,account_id,instrument_id,units,value) VALUES (?,?,?,?,?) "
            "ON CONFLICT(date,account_id,instrument_id) DO UPDATE SET units=excluded.units,value=excluded.value",
            rows["snapshots"],
        )
    return {"importId": import_id, **counts, "imported": inserted,
            "duplicates": len(rows["transactions"]) - inserted, "skipped": rows["skipped"],
            "snapshotsWritten": len(rows["snapshots"]), "statementPeriod": rows["statement_period"]}


def import_cas(conn, content, password):
    try:
        data = casparser.read_cas_pdf(BytesIO(content), password=password, output="dict")
        # casparser 1.x calls its Pydantic model output "dict".
        if hasattr(data, "model_dump"):
            data = data.model_dump(mode="json", by_alias=True)
    except IncorrectPasswordError as exc:
        raise HTTPException(400, "Incorrect CAS PDF password.") from exc
    except Exception as exc:
        raise HTTPException(400, "Could not parse CAS PDF. Use a CAMS or KFintech statement with valid scheme identifiers.") from exc
    try:
        rows = map_statement(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return write_statement(conn, rows, hashlib.sha256(content).hexdigest())
