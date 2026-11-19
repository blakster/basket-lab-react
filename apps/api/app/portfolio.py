import math
import re
import sqlite3
from datetime import date


def as_of_date(value=None):
    if value is None:
        return date.today().isoformat()
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("date must be YYYY-MM-DD")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValueError("date must be YYYY-MM-DD") from None


def finite_number(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a finite number >= 0")
    try:
        number = float(value)
    except OverflowError:
        raise ValueError(f"{field} must be a finite number >= 0") from None
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{field} must be a finite number >= 0")
    return number


def manual_assets(conn: sqlite3.Connection):
    assets = []
    for row in conn.execute(
        "SELECT id, name, kind FROM instruments WHERE id LIKE 'manual:%' ORDER BY id"
    ):
        history = [dict(value) for value in conn.execute(
            "SELECT date, value FROM snapshots WHERE account_id = ? AND instrument_id = ? ORDER BY date",
            ("manual", row["id"]),
        )]
        assets.append({**dict(row), "latest": history[-1] if history else None, "history": history})
    return assets


def save_manual_asset(conn: sqlite3.Connection, body):
    if not isinstance(body, dict):
        raise ValueError("asset object required")
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("name required")
    name = name.strip()
    slug = re.sub(r"[^\w]+", "-", name.lower()).strip("-")
    if not slug:
        raise ValueError("name must contain letters or numbers")
    instrument_id = f"manual:{slug}"
    kind = body.get("kind")
    if kind == "savings":
        kind = "cash"
    if kind not in ("cash", "epf", "ulip", "gold"):
        raise ValueError("kind must be cash, savings, epf, ulip or gold")
    value = finite_number(body.get("value"), "value")
    units = finite_number(body.get("units", 0), "units")
    snapshot_date = as_of_date(body.get("date"))
    with conn:
        conn.execute(
            "INSERT INTO accounts (id, provider, label) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
            ("manual", "manual", "Manual"),
        )
        conn.execute(
            "INSERT INTO instruments (id, name, kind) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind",
            (instrument_id, name, kind),
        )
        conn.execute(
            "INSERT INTO snapshots (date, account_id, instrument_id, units, value) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(date, account_id, instrument_id) DO UPDATE SET units = excluded.units, value = excluded.value",
            (snapshot_date, "manual", instrument_id, units, value),
        )
    return next(asset for asset in manual_assets(conn) if asset["id"] == instrument_id)


def delete_manual_asset(conn: sqlite3.Connection, instrument_id: str):
    if not instrument_id.startswith("manual:") or not conn.execute(
        "SELECT 1 FROM instruments WHERE id = ?", (instrument_id,)
    ).fetchone():
        return False
    with conn:
        conn.execute("DELETE FROM snapshots WHERE instrument_id = ?", (instrument_id,))
        conn.execute("DELETE FROM instruments WHERE id = ?", (instrument_id,))
    return True


def networth(conn: sqlite3.Connection, snapshot_date=None):
    as_of = as_of_date(snapshot_date)
    items = [dict(row) for row in conn.execute(
        'SELECT s.account_id AS accountId, s.instrument_id AS instrumentId, '
        'i.name, i.kind, s.date, s.value FROM snapshots s '
        'JOIN instruments i ON i.id = s.instrument_id '
        'JOIN accounts a ON a.id = s.account_id '
        'WHERE s.date <= ? AND NOT EXISTS ('
        'SELECT 1 FROM snapshots newer WHERE newer.account_id = s.account_id '
        "AND (a.provider != 'manual' OR newer.instrument_id = s.instrument_id) "
        'AND newer.date > s.date AND newer.date <= ?) '
        'ORDER BY s.account_id, s.instrument_id',
        (as_of, as_of),
    )]
    by_kind = {}
    for item in items:
        by_kind[item["kind"]] = by_kind.get(item["kind"], 0) + item["value"]
    return {"asOf": as_of, "total": sum(item["value"] for item in items), "byKind": by_kind, "items": items}
