"""CAMS/KFin CAS mapping plus NSDL/CDSL depository holdings. Amounts and units are magnitudes; kind carries direction."""

import hashlib
import json
import re
import threading
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
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
            instruments[instrument] = (instrument, "mf", scheme["scheme"], scheme.get("isin"), None)
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


def _demat_date(value):
    text = str(value).strip()
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        pass
    try:
        return datetime.strptime(text, "%d-%b-%Y").date().isoformat()
    except ValueError:
        raise ValueError(f"Unrecognised statement date: {value}") from None


# Depository MF rows prefix the scheme name with the AMC code ("9645 - ...").
_AMC_PREFIX = re.compile(r"^[A-Z0-9]{3,6}\s*-\s+")


def _demat_scheme_name(raw):
    name = _AMC_PREFIX.sub("", str(raw or "")).strip()
    # The PDF text layer leaks control characters into security names, and
    # depository text uses # as a security-type separator.
    clean = "".join(ch for ch in name if ch.isprintable())
    return re.sub(r"\s+", " ", clean.replace("#", " ")).strip()


def map_demat_statement(data):
    """Map an NSDL/CDSL casparser dict without I/O.

    Depository statements carry no transaction ledger casparser reads, so
    every holding lands as a closing snapshot: units and value are exact
    while cost history stays unknown, and the web hides gain/XIRR for it.
    """
    period = data.get("statement_period") or {}
    try:
        day = _demat_date(period["to"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Statement period is missing or unreadable.") from exc
    issuer = str(data.get("file_type") or "cdsl").lower()
    accounts, instruments, snapshots = {}, {}, {}
    skipped = 0
    for demat in data["accounts"]:
        dp = str(demat.get("dp_id") or "").strip()
        client = str(demat.get("client_id") or "").strip()
        demat_account = None
        if dp or client:
            demat_account = f"{issuer}:demat:{dp}{client}"
            accounts[demat_account] = (
                demat_account, issuer, str(demat.get("name") or demat_account)
            )
        for kind, key, units_key in (
            ("stock", "equities", "num_shares"),
            ("mf", "mutual_funds", "balance"),
            ("other", "bonds", "num_bonds"),
        ):
            for holding in demat.get(key) or []:
                isin = str(holding.get("isin") or "").strip().upper() or None
                if kind == "mf":
                    amfi = str(holding.get("amfi") or "").strip()
                    instrument = (
                        f"amfi:{amfi}" if amfi else f"isin:{isin}" if isin else None
                    )
                else:
                    instrument = f"isin:{isin}" if isin else None
                if instrument is None:
                    skipped += 1
                    continue
                folio = (
                    str(holding.get("folio") or "").strip() if kind == "mf" else ""
                )
                if folio:
                    account = f"{issuer}:folio:{folio}"
                    accounts.setdefault(account, (account, issuer, f"MF folio {folio}"))
                elif demat_account:
                    account = demat_account
                else:
                    skipped += 1
                    continue
                name = _demat_scheme_name(holding.get("name")) or isin or instrument
                symbol = (
                    str(holding.get("symbol") or "").strip().upper() or None
                    if kind == "stock"
                    else None
                )
                instruments[instrument] = (instrument, kind, name, isin, symbol)
                snapshots[(day, account, instrument)] = (
                    day, account, instrument,
                    float(_number(holding.get(units_key) or 0)),
                    float(_number(holding.get("value") or 0)),
                )
    if not data["accounts"]:
        # A depository import replaces the issuer's snapshots, so a parse
        # that read the statement date but missed every account must not be
        # treated as a liquidation. Parsed accounts with no holdings are
        # fine: that is what a fully redeemed statement looks like.
        raise ValueError("Statement lists no accounts; nothing to import.")
    if not snapshots and skipped:
        # Accounts parsed but no holding mapped to an account and instrument:
        # a degraded parse, not a liquidation, so the replace must not wipe
        # the issuer's snapshots. A fully redeemed statement skips nothing.
        raise ValueError("Statement holdings could not be read; nothing to import.")
    if not snapshots:
        # casparser reads each account's balance from the summary block even
        # when it drops detail rows it cannot parse; a positive balance with
        # no mapped holding is a degraded read, not a liquidation.
        for demat in data["accounts"]:
            try:
                balance = Decimal(str(demat.get("balance") or "0"))
            except InvalidOperation:
                continue
            if balance > 0:
                raise ValueError("Statement balances could not be read; nothing to import.")
    return {"accounts": list(accounts.values()), "instruments": list(instruments.values()),
            "transactions": [], "snapshots": list(snapshots.values()),
            "skipped": skipped, "statement_period": period,
            # A depository statement is the issuer's complete picture at its
            # date, so holdings it no longer lists must stop counting.
            "replace_snapshots": True, "replace_provider": issuer, "snapshot_date": day}


# FastAPI runs sync endpoints on worker threads; casparser's PDFium binding and
# the shared SQLite connection are not safe for concurrent imports.
_IMPORT_LOCK = threading.Lock()


def write_statement(conn, rows, import_id):
    counts = {}
    with conn:
        for table, columns in (("accounts", "id,provider,label"), ("instruments", "id,kind,name,isin,symbol")):
            inserted = 0
            for row in rows[table]:
                cursor = conn.execute(
                    f'INSERT OR IGNORE INTO {table} ({columns}) VALUES ({",".join("?" for _ in row)})', row
                )
                inserted += cursor.rowcount
                if table == "instruments" and row[4]:
                    conn.execute("UPDATE instruments SET symbol = ? WHERE id = ?", (row[4], row[0]))
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
        if rows.get("replace_snapshots"):
            # One depository CAS covers every account with that depository,
            # including folios it no longer lists, so replace all of the
            # issuer's snapshots. A zero snapshot records the absence: without
            # it a later older statement could resurrect a redeemed holding.
            provider = rows["replace_provider"]
            account_ids = [
                row[0]
                for row in conn.execute(
                    "SELECT DISTINCT account_id FROM snapshots WHERE account_id IN "
                    "(SELECT id FROM accounts WHERE provider = ?)",
                    (provider,),
                )
            ]
            if account_ids:
                marks = ",".join("?" for _ in account_ids)
                known = conn.execute(
                    f"SELECT DISTINCT account_id, instrument_id FROM snapshots "
                    f"WHERE account_id IN ({marks})",
                    account_ids,
                ).fetchall()
                conn.execute(
                    f"DELETE FROM snapshots WHERE date <= ? AND account_id IN ({marks})",
                    (rows["snapshot_date"], *account_ids),
                )
                current = {(row[1], row[2]) for row in rows["snapshots"]}
                for account_id, instrument_id in known:
                    if (account_id, instrument_id) not in current:
                        rows["snapshots"].append(
                            (rows["snapshot_date"], account_id, instrument_id, 0.0, 0.0)
                        )
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
            raise HTTPException(400, "Could not parse CAS PDF. Use a CAMS, KFintech, NSDL or CDSL statement with valid scheme identifiers.") from exc
        # RTA statements carry folios; NSDL/CDSL depository statements carry
        # accounts with holdings only.
        if not isinstance(data, dict) or ("folios" not in data and "accounts" not in data):
            raise HTTPException(400, "Could not parse CAS PDF. Use a CAMS, KFintech, NSDL or CDSL statement with valid scheme identifiers.")
        try:
            rows = map_statement(data) if "folios" in data else map_demat_statement(data)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        rows["warnings"] = data.get("parse_warnings") or []
        return write_statement(conn, rows, hashlib.sha256(content).hexdigest())
