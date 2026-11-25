"""Regular-plan commission check enrichment for portfolio holdings."""

from __future__ import annotations

import math
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Callable

from app.ingest.foliyo import call_foliyo_tool
from app.ingest.scheme_master import SchemeMaster, SchemeRow, _norm
from app.portfolio import scheme_code_for_instrument

MAX_INSTRUMENT_IDS = 200
EXPENSE_RATIO_FRESH_DAYS = 45


@dataclass(frozen=True)
class ExpenseRatio:
    value: float
    as_of: str | None


ExpenseFetcher = Callable[[str], ExpenseRatio | None]


def _number(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _iso_date(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def fetch_expense_ratio(scheme_code: str) -> ExpenseRatio | None:
    payload = call_foliyo_tool(
        "get_fund_details",
        {
            "fund": scheme_code,
            "sections": ["overview"],
            "holdings_limit": 1,
        },
    )
    overview = payload.get("overview") if isinstance(payload.get("overview"), dict) else {}
    value = _number(overview.get("expense_ratio_pct"))
    if value is None:
        return None
    return ExpenseRatio(
        value=value,
        as_of=_iso_date(overview.get("expense_ratio_as_of")),
    )


def _safe_fetch(fetcher: ExpenseFetcher, scheme_code: str) -> ExpenseRatio | None:
    try:
        return fetcher(scheme_code)
    except Exception:
        # Foliyo is a network boundary: one unavailable scheme must not blank
        # the whole commission check.
        return None


def _fresh_expense(expense: ExpenseRatio, *, today: date | None = None) -> bool:
    if expense.as_of is None:
        return False
    try:
        as_of = date.fromisoformat(expense.as_of)
    except ValueError:
        return False
    age = ((today or date.today()) - as_of).days
    return 0 <= age <= EXPENSE_RATIO_FRESH_DAYS


def _cached_expenses(
    conn: sqlite3.Connection | None, scheme_codes: list[str]
) -> dict[str, ExpenseRatio]:
    if conn is None or not scheme_codes:
        return {}
    marks = ",".join("?" for _ in scheme_codes)
    try:
        rows = conn.execute(
            f"""
            SELECT scheme_code, expense_ratio, expense_ratio_as_of
            FROM commission_expense_cache
            WHERE scheme_code IN ({marks})
            """,
            scheme_codes,
        ).fetchall()
    except sqlite3.Error:
        return {}
    expenses = {}
    for row in rows:
        value = _number(row["expense_ratio"])
        as_of = _iso_date(row["expense_ratio_as_of"])
        if value is None or as_of is None:
            continue
        expense = ExpenseRatio(value, as_of)
        if _fresh_expense(expense):
            expenses[row["scheme_code"]] = expense
    return expenses


def _cache_expenses(
    conn: sqlite3.Connection | None, expenses: dict[str, ExpenseRatio]
) -> None:
    if conn is None or not expenses:
        return
    fetched_at = datetime.now(timezone.utc).isoformat()
    try:
        conn.executemany(
            """
            INSERT INTO commission_expense_cache
              (scheme_code, expense_ratio, expense_ratio_as_of, fetched_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(scheme_code) DO UPDATE SET
              expense_ratio = excluded.expense_ratio,
              expense_ratio_as_of = excluded.expense_ratio_as_of,
              fetched_at = excluded.fetched_at
            """,
            [
                (code, expense.value, expense.as_of, fetched_at)
                for code, expense in expenses.items()
            ],
        )
        conn.commit()
    except sqlite3.Error:
        # The cache is an optimization; a locked or read-only database must not
        # make the commission check unavailable.
        pass


def _expense_ratios(
    cache_conn: sqlite3.Connection | None,
    scheme_codes: list[str],
    fetcher: ExpenseFetcher,
) -> dict[str, ExpenseRatio]:
    unique = sorted(set(scheme_codes))
    if not unique:
        return {}
    expenses = _cached_expenses(cache_conn, unique)
    missing = [code for code in unique if code not in expenses]
    if not missing:
        return expenses
    with ThreadPoolExecutor(max_workers=min(4, len(missing))) as pool:
        fetched = list(pool.map(lambda code: _safe_fetch(fetcher, code), missing))
    fresh = {
        code: expense
        for code, expense in zip(missing, fetched)
        if expense is not None and _fresh_expense(expense)
    }
    _cache_expenses(cache_conn, fresh)
    return {**expenses, **fresh}


def _plan_classification(name: str, row: SchemeRow | None) -> str:
    if row is not None:
        plan = row.scheme_plan.strip().lower()
        if plan in {"direct", "regular"}:
            return plan
    tokens = _norm(name).split()
    if "direct" in tokens:
        return "direct"
    if "regular" in tokens:
        return "regular"
    return "unknown"


def commission_check(
    conn: sqlite3.Connection,
    master: SchemeMaster,
    instrument_ids: object,
    expense_fetcher: ExpenseFetcher | None = None,
    cache_conn: sqlite3.Connection | None = None,
) -> dict:
    if not isinstance(instrument_ids, list) or len(instrument_ids) > MAX_INSTRUMENT_IDS:
        raise ValueError("instrumentIds must be a list of at most 200 ids.")
    ids = []
    for item in instrument_ids:
        text = str(item or "").strip()
        if text and text not in ids:
            ids.append(text)
    if not ids:
        return {"rows": []}

    marks = ",".join("?" for _ in ids)
    instruments = {
        row["id"]: row
        for row in conn.execute(
            f"SELECT id, kind, name, isin FROM instruments WHERE id IN ({marks})",
            ids,
        )
    }
    fetcher = expense_fetcher or fetch_expense_ratio
    pending = []
    expense_codes = []
    for instrument_id in ids:
        instrument = instruments.get(instrument_id)
        if instrument is None or instrument["kind"] != "mf":
            continue
        scheme_code = scheme_code_for_instrument(
            instrument["id"], instrument["isin"], master
        )
        scheme_row = master.by_code(scheme_code) if scheme_code else None
        plan = _plan_classification(instrument["name"], scheme_row)
        if plan == "direct":
            continue
        direct = master.direct_counterpart(scheme_code) if scheme_code else None
        if plan == "unknown" and direct is None:
            continue
        item = {
            "instrumentId": instrument_id,
            "schemeCode": scheme_code,
            "schemeName": instrument["name"],
            "directSchemeCode": direct.scheme_code if direct else None,
            "directSchemeName": direct.scheme_name if direct else None,
        }
        pending.append(item)
        if direct is not None and scheme_code:
            expense_codes.extend([scheme_code, direct.scheme_code])

    expenses = _expense_ratios(cache_conn, expense_codes, fetcher)
    rows = []
    for item in pending:
        if item["directSchemeCode"] is None:
            rows.append({**item, "status": "missing-direct-plan"})
            continue
        regular = expenses.get(item["schemeCode"] or "")
        direct = expenses.get(item["directSchemeCode"])
        if regular is None or direct is None:
            rows.append({**item, "status": "missing-expense-ratio"})
            continue
        rows.append(
            {
                **item,
                "status": "ready",
                "regularExpenseRatio": regular.value,
                "directExpenseRatio": direct.value,
                "expenseGapPct": round(regular.value - direct.value, 4),
                "regularExpenseRatioAsOf": regular.as_of,
                "directExpenseRatioAsOf": direct.as_of,
            }
        )
    return {"rows": rows}
