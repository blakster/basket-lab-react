"""CAMS/KFin CAS mapping. Amounts and units are magnitudes; kind carries direction."""

import hashlib
import json
import threading
from collections import Counter
from datetime import date
from decimal import Decimal
from io import BytesIO

import casparser
from casparser.exceptions import IncorrectPasswordError
from fastapi import HTTPException

from app.portfolio import manual_transaction_duplicate


KINDS = {
    "PURCHASE": "buy", "PURCHASE_SIP": "sip", "REDEMPTION": "sell",
    "SWITCH_IN": "switch-in", "SWITCH_IN_MERGER": "switch-in",
    "SWITCH_OUT": "switch-out", "SWITCH_OUT_MERGER": "switch-out",
    "DIVIDEND_PAYOUT": "dividend", "DIVIDEND_REINVEST": "dividend",
    # casparser emits REVERSAL only for negative-unit rows, i.e. a canceled
    # purchase; as a sell it refunds the cash and removes the units, netting
    # the original purchase to zero across invested, proceeds and units held.
    "REVERSAL": "sell",
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


# FastAPI runs sync endpoints on worker threads; casparser's PDFium binding and
# the shared SQLite connection are not safe for concurrent imports.
_IMPORT_LOCK = threading.Lock()


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
            _identity, _account, instrument, day, kind, units, amount = row
            # A transaction already entered by hand is the same cash movement.
            # The statement supersedes the hand-entered copy: keeping the
            # statement row preserves folio coverage, dropping the manual row
            # prevents the units from counting twice.
            manual = manual_transaction_duplicate(
                conn, instrument_id=instrument, day=day, kind=kind, units=units, amount=amount
            )
            if manual is not None:
                conn.execute("DELETE FROM transactions WHERE id = ?", (manual["id"],))
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
            "snapshotsWritten": len(rows["snapshots"]), "statementPeriod": rows["statement_period"],
            "warnings": rows.get("warnings", [])}


def import_cas(conn, content, password):
    with _IMPORT_LOCK:
        try:
            data = casparser.read_cas_pdf(BytesIO(content), password=password, output="dict")
            # casparser 1.x calls its Pydantic model output "dict".
            if hasattr(data, "model_dump"):
                data = data.model_dump(mode="json", by_alias=True)
        except IncorrectPasswordError as exc:
            raise HTTPException(400, "Incorrect CAS PDF password.") from exc
        except Exception as exc:
            raise HTTPException(400, "Could not parse CAS PDF. Use a CAMS or KFintech statement with valid scheme identifiers.") from exc
        # NSDL/CDSL statements parse to accounts, not folios.
        if not isinstance(data, dict) or "folios" not in data:
            raise HTTPException(400, "Could not parse CAS PDF. Use a CAMS or KFintech statement with valid scheme identifiers.")
        try:
            rows = map_statement(data)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        rows["warnings"] = data.get("parse_warnings") or []
        return write_statement(conn, rows, hashlib.sha256(content).hexdigest())
