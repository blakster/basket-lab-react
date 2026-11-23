"""Portfolio domain reads: accounts, instruments, transactions, latest snapshots."""

import sqlite3

from app.ingest.scheme_master import SchemeMaster


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
        }
        for row in conn.execute(
            "SELECT id, account_id, instrument_id, date, kind, units, amount "
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
