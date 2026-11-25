"""Regular-plan commission check enrichment for portfolio holdings."""

from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable

from app.ingest.foliyo import call_foliyo_tool
from app.ingest.parse import load_fundamentals
from app.ingest.scheme_master import SchemeMaster, SchemeRow, _norm
from app.portfolio import scheme_code_for_instrument

MAX_INSTRUMENT_IDS = 200
EXPENSE_RATIO_MAX_AGE_DAYS = 45


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
    if number != number:
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


def _latest_expenses(
    conn: sqlite3.Connection, scheme_codes: list[str]
) -> dict[str, ExpenseRatio]:
    if not scheme_codes:
        return {}
    marks = ",".join("?" for _ in scheme_codes)
    fresh_after = (
        date.today() - timedelta(days=EXPENSE_RATIO_MAX_AGE_DAYS)
    ).isoformat()
    rows = conn.execute(
        f"""
        SELECT f.scheme_code, f.expense_ratio, f.as_of
        FROM fundamentals f
        JOIN (
          SELECT scheme_code, MAX(as_of) AS max_as_of
          FROM fundamentals
          WHERE scheme_code IN ({marks})
            AND as_of >= ?
          GROUP BY scheme_code
        ) latest
          ON latest.scheme_code = f.scheme_code
         AND latest.max_as_of = f.as_of
        """,
        [*scheme_codes, fresh_after],
    ).fetchall()
    return {
        row["scheme_code"]: ExpenseRatio(float(row["expense_ratio"]), row["as_of"])
        for row in rows
        if row["expense_ratio"] is not None
    }


def _safe_fetch(fetcher: ExpenseFetcher, scheme_code: str) -> ExpenseRatio | None:
    try:
        return fetcher(scheme_code)
    except Exception:
        # Foliyo is a network boundary: one unavailable scheme must not blank
        # the whole commission check.
        return None


def _expense_ratios(
    conn: sqlite3.Connection,
    scheme_codes: list[str],
    fetcher: ExpenseFetcher,
) -> dict[str, ExpenseRatio]:
    unique = sorted(set(scheme_codes))
    expenses = _latest_expenses(conn, unique)
    missing = [code for code in unique if code not in expenses]
    if not missing:
        return expenses
    with ThreadPoolExecutor(max_workers=min(4, len(missing))) as pool:
        fetched = list(pool.map(lambda code: _safe_fetch(fetcher, code), missing))
    for code, expense in zip(missing, fetched):
        if expense is None:
            continue
        expenses[code] = expense
        if expense.as_of:
            load_fundamentals(
                conn,
                expense.as_of,
                code,
                expense_ratio=expense.value,
            )
    return expenses


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

    expenses = _expense_ratios(conn, expense_codes, fetcher) if expense_codes else {}
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
