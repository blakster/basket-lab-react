"""Portfolio domain reads and manual transaction writes."""

import math
import sqlite3
import uuid
from datetime import date

from app.ingest.scheme_master import SchemeMaster

MANUAL_IMPORT_ID = "manual"
MANUAL_ACCOUNT_ID = "manual:entry"
MANUAL_ACCOUNT = (MANUAL_ACCOUNT_ID, "manual", "Manual entry")
MANUAL_KINDS = {"buy", "sell"}


class DuplicateTransaction(ValueError):
    """The same transaction already exists from a statement or manual entry."""


def _scheme_code(instrument_id: str, isin: str | None, master: SchemeMaster | None) -> str | None:
    if instrument_id.startswith("amfi:"):
        return instrument_id.split(":", 1)[1] or None
    if isin and master is not None:
        return master.lookup(scheme_isin=isin)
    return None


def portfolio(conn: sqlite3.Connection, master: SchemeMaster | None = None) -> dict:
    accounts = [
        {"id": row["id"], "provider": row["provider"], "label": row["label"]}
        for row in conn.execute("SELECT id, provider, label FROM accounts ORDER BY id")
    ]
    instruments = []
    for row in conn.execute(
        "SELECT id, kind, name, isin FROM instruments ORDER BY name, id"
    ):
        instruments.append(
            {
                "id": row["id"],
                "kind": row["kind"],
                "name": row["name"],
                "isin": row["isin"],
                "schemeCode": _scheme_code(row["id"], row["isin"], master),
            }
        )
    transactions = [
        {
            "id": row["id"],
            "accountId": row["account_id"],
            "instrumentId": row["instrument_id"],
            "date": row["date"],
            "kind": row["kind"],
            "units": row["units"],
            "amount": row["amount"],
            "manual": row["import_id"] == MANUAL_IMPORT_ID,
        }
        for row in conn.execute(
            "SELECT id, account_id, instrument_id, date, kind, units, amount, import_id "
            "FROM transactions ORDER BY date, id"
        )
    ]
    # Latest statement valuation per account + instrument; the growth math values
    # NAV-backed funds from NAV instead, snapshots are the fallback.
    snapshots = [
        {"date": row["date"], "accountId": row["account_id"],
         "instrumentId": row["instrument_id"], "units": row["units"], "value": row["value"]}
        for row in conn.execute(
            """
            SELECT s.date, s.account_id, s.instrument_id, s.units, s.value
            FROM snapshots s
            JOIN (SELECT account_id, instrument_id, MAX(date) AS max_date
                  FROM snapshots GROUP BY account_id, instrument_id) latest
              ON latest.account_id = s.account_id
             AND latest.instrument_id = s.instrument_id
             AND latest.max_date = s.date
            ORDER BY s.account_id, s.instrument_id
            """
        )
    ]
    return {"accounts": accounts, "instruments": instruments,
            "transactions": transactions, "snapshots": snapshots}


def _duplicate(
    conn: sqlite3.Connection,
    *,
    instrument_id: str,
    day: str,
    kind: str,
    units: float,
    amount: float,
    manual_only: bool = False,
) -> sqlite3.Row | None:
    # CAS files SIPs under their own kind; a hand-entered SIP is a buy. The
    # same fund can carry different ids (amfi: vs isin:), so match on ISIN too.
    normalized = "buy" if kind in {"buy", "sip"} else kind
    isin_row = conn.execute(
        "SELECT isin FROM instruments WHERE id = ?", (instrument_id,)
    ).fetchone()
    isin = isin_row["isin"] if isin_row else None
    if isin:
        instrument_match = (
            "(t.instrument_id = ? OR t.instrument_id IN "
            "(SELECT i2.id FROM instruments i2 WHERE i2.isin = ?))"
        )
    else:
        instrument_match = "t.instrument_id = ?"
    sql = (
        f"SELECT t.id FROM transactions t WHERE {instrument_match} AND t.date = ? "
        "AND CASE WHEN t.kind IN ('buy', 'sip') THEN 'buy' ELSE t.kind END = ? "
        "AND ROUND(t.units, 3) = ROUND(?, 3) AND ROUND(t.amount, 2) = ROUND(?, 2)"
    )
    params: list[object] = [instrument_id]
    if isin:
        params.append(isin)
    params += [day, normalized, units, amount]
    if manual_only:
        sql += " AND t.import_id = ?"
        params.append(MANUAL_IMPORT_ID)
    return conn.execute(sql + " LIMIT 1", params).fetchone()


def manual_transaction_duplicate(
    conn: sqlite3.Connection,
    *,
    instrument_id: str,
    day: str,
    kind: str,
    units: float,
    amount: float,
) -> sqlite3.Row | None:
    """CAS import guard: a statement row already entered by hand must not land twice."""
    return _duplicate(
        conn,
        instrument_id=instrument_id,
        day=day,
        kind=kind,
        units=units,
        amount=amount,
        manual_only=True,
    )


def _positive(name: str, value: object) -> float:
    # JSON booleans coerce to 1.0/0.0; they are never a unit or amount.
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number.")
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number.") from None
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{name} must be greater than zero.")
    return number


def add_manual_transaction(conn: sqlite3.Connection, body: object) -> dict:
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object.")
    kind = str(body.get("kind") or "").strip()
    if kind not in MANUAL_KINDS:
        raise ValueError("kind must be 'buy' or 'sell'.")
    try:
        day = date.fromisoformat(str(body.get("date") or "").strip()).isoformat()
    except ValueError:
        raise ValueError("date must be YYYY-MM-DD.") from None
    if day > date.today().isoformat():
        raise ValueError("date cannot be in the future.")
    units = _positive("units", body.get("units"))
    amount = _positive("amount", body.get("amount"))

    instrument_id = str(body.get("instrumentId") or "").strip()
    if instrument_id:
        row = conn.execute(
            "SELECT id FROM instruments WHERE id = ?", (instrument_id,)
        ).fetchone()
        if row is None:
            raise ValueError("unknown instrument.")
    else:
        scheme = body.get("scheme")
        if not isinstance(scheme, dict):
            raise ValueError("scheme or instrumentId required.")
        code = str(scheme.get("schemeCode") or "").strip()
        if not code:
            raise ValueError("schemeCode required.")
        name = str(scheme.get("name") or "").strip() or code
        raw_isin = scheme.get("isin")
        isin = str(raw_isin).strip().upper() if raw_isin else None
        # Reuse the statement's instrument when the ISIN is already known, so
        # hand entries and CAS rows share one identity per fund.
        # Prefer the amfi: row when a fund exists under both ids: its NAV code
        # is in the id, while an isin: row depends on the scheme master.
        existing = (
            conn.execute(
                "SELECT id FROM instruments WHERE isin = ? "
                "ORDER BY CASE WHEN id LIKE 'amfi:%' THEN 0 ELSE 1 END, id LIMIT 1",
                (isin,),
            ).fetchone()
            if isin
            else None
        )
        if existing is not None:
            instrument_id = existing["id"]
        else:
            instrument_id = f"amfi:{code}"
            with conn:
                conn.execute(
                    "INSERT OR IGNORE INTO instruments (id, kind, name, isin) VALUES (?, 'mf', ?, ?)",
                    (instrument_id, name, isin),
                )

    if _duplicate(
        conn, instrument_id=instrument_id, day=day, kind=kind, units=units, amount=amount
    ):
        raise DuplicateTransaction(
            "This transaction is already in your portfolio, from an imported "
            "statement or an earlier manual entry."
        )

    tx_id = f"manual:{uuid.uuid4().hex}"
    with conn:
        conn.execute(
            "INSERT INTO accounts (id, provider, label) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO NOTHING",
            MANUAL_ACCOUNT,
        )
        conn.execute(
            "INSERT INTO transactions "
            "(id, account_id, instrument_id, date, kind, units, amount, import_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (tx_id, MANUAL_ACCOUNT_ID, instrument_id, day, kind, units, amount, MANUAL_IMPORT_ID),
        )
    return {
        "id": tx_id,
        "accountId": MANUAL_ACCOUNT_ID,
        "instrumentId": instrument_id,
        "date": day,
        "kind": kind,
        "units": units,
        "amount": amount,
        "manual": True,
    }


def delete_manual_transaction(conn: sqlite3.Connection, tx_id: str) -> bool:
    row = conn.execute(
        "SELECT import_id FROM transactions WHERE id = ?", (tx_id,)
    ).fetchone()
    if row is None:
        return False
    if row["import_id"] != MANUAL_IMPORT_ID:
        raise ValueError("Only transactions added manually can be deleted.")
    with conn:
        conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    return True
