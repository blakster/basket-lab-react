from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from app.filing_status import FilingStatus, filing_statuses

CREDIT_NOTE_NO_DEBT = "N/A — no debt holdings"
EQUITY_BUCKETS = ("large", "mid", "small", "unclassified")
TOP_N = 10
_COVERED_STATES = frozenset({"fresh", "stale"})


def compute_insights(
    conn: sqlite3.Connection,
    body: dict[str, Any],
    filings_by_code: dict[str, FilingStatus] | None = None,
) -> dict[str, Any]:
    as_of = _latest_as_of(conn)
    out_baskets: list[dict[str, Any]] = []
    filing_weights: list[tuple[str, dict[str, float]]] = []

    if filings_by_code is None:
        codes: list[str] = []
        seen: set[str] = set()
        for raw in body.get("baskets") or []:
            for fund in raw.get("funds") or []:
                code = str(fund.get("schemeCode") or "").strip()
                if code and code not in seen:
                    seen.add(code)
                    codes.append(code)
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        filings_by_code = filing_statuses(conn, codes, month)

    for raw in body.get("baskets") or []:
        basket_id = str(raw.get("id", ""))
        funds = raw.get("funds") or []
        rolled, isin_weights, has_filing = _roll_basket(conn, as_of, funds)
        coverage = _filing_coverage(funds, filings_by_code)
        out_baskets.append({"id": basket_id, **rolled, **coverage})
        if has_filing:
            filing_weights.append((basket_id, isin_weights))

    overlap: dict[str, float] | None = None
    if len(filing_weights) >= 2:
        overlap = {}
        for i, (id_a, w_a) in enumerate(filing_weights):
            for id_b, w_b in filing_weights[i + 1 :]:
                left, right = sorted((id_a, id_b))
                key = f"{left}|{right}"
                isins = set(w_a) | set(w_b)
                overlap[key] = sum(min(w_a.get(k, 0.0), w_b.get(k, 0.0)) for k in isins)

    return {"asOf": as_of, "baskets": out_baskets, "overlap": overlap}


def _filing_coverage(
    funds: list[dict[str, Any]],
    filings_by_code: dict[str, FilingStatus],
) -> dict[str, Any]:
    filings: list[dict[str, object]] = []
    covered = 0
    latest_as_of: str | None = None
    for fund in funds:
        code = str(fund.get("schemeCode") or "").strip()
        status = filings_by_code.get(code)
        if status is None:
            filings.append(
                {
                    "schemeCode": code,
                    "state": "unmapped",
                    "requestedMonth": "",
                    "attemptedAt": "",
                    "finishedAt": None,
                    "asOf": None,
                    "amc": None,
                    "sourceUrl": None,
                    "reason": None,
                }
            )
            continue
        filings.append(_serialize_status(status))
        if status.state in _COVERED_STATES and status.as_of:
            covered += 1
            if latest_as_of is None or status.as_of > latest_as_of:
                latest_as_of = status.as_of
    return {
        "filings": filings,
        "filingCoverage": {"covered": covered, "total": len(funds)},
        "filingAsOf": latest_as_of,
    }


def _serialize_status(status: FilingStatus) -> dict[str, object]:
    return {
        "schemeCode": status.scheme_code,
        "state": status.state,
        "requestedMonth": status.requested_month,
        "attemptedAt": status.attempted_at,
        "finishedAt": status.finished_at,
        "asOf": status.as_of,
        "amc": status.amc,
        "sourceUrl": status.source_url,
        "reason": status.reason,
    }


def _latest_as_of(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT MAX(as_of) FROM holdings").fetchone()
    return row[0] if row is not None else None


def _roll_basket(
    conn: sqlite3.Connection,
    as_of: str | None,
    funds: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, float], bool]:
    missing: list[str] = []
    lines: list[dict[str, Any]] = []
    pe_pairs: list[tuple[float, float]] = []
    exp_pairs: list[tuple[float, float]] = []

    for fund in funds:
        scheme = str(fund.get("schemeCode") or "")
        fund_w = float(fund.get("weight") or 0)
        rows = _holdings_for(conn, scheme, as_of)
        if not rows:
            if scheme:
                missing.append(scheme)
            continue
        scale = fund_w / 100.0
        for row in rows:
            lines.append(
                {
                    "isin": row["isin"],
                    "name": row["instrument_name"],
                    "asset_class": row["asset_class"],
                    "sector": row["sector"],
                    "rating": row["rating"],
                    "market_cap_bucket": row["market_cap_bucket"],
                    "weight": scale * float(row["weight_pct"]),
                }
            )
        funda = _fundamentals_for(conn, scheme, as_of)
        if funda is not None:
            if funda["pe"] is not None:
                pe_pairs.append((fund_w, float(funda["pe"])))
            if funda["expense_ratio"] is not None:
                exp_pairs.append((fund_w, float(funda["expense_ratio"])))

    holdings = _top_holdings(lines)
    sector = _sum_by(lines, "sector", missing_label="Unclassified")
    asset = _sum_by(lines, "asset_class", missing_label="Unclassified")
    credit, credit_note = _credit(lines)
    equity_split = _equity_split(lines)
    pe, pe_incomplete = _avg_known(pe_pairs, len(funds))
    expense, expense_incomplete = _avg_known(exp_pairs, len(funds))

    isin_weights: dict[str, float] = defaultdict(float)
    for line in lines:
        isin = line["isin"]
        if isin:
            isin_weights[isin] += line["weight"]

    payload = {
        "missingSchemes": missing,
        "holdings": holdings,
        "sector": sector,
        "asset": asset,
        "credit": credit,
        "creditNote": credit_note,
        "equitySplit": equity_split,
        "expenseRatio": expense,
        "expenseIncomplete": expense_incomplete,
        "pe": pe,
        "peIncomplete": pe_incomplete,
    }
    return payload, dict(isin_weights), bool(lines)


def _holdings_for(
    conn: sqlite3.Connection, scheme: str, as_of: str | None
) -> list[sqlite3.Row]:
    if not scheme or not as_of:
        return []
    return conn.execute(
        """
        SELECT isin, instrument_name, asset_class, sector, rating,
               market_cap_bucket, weight_pct
        FROM holdings
        WHERE scheme_code = ? AND as_of = ?
        """,
        (scheme, as_of),
    ).fetchall()


def _fundamentals_for(
    conn: sqlite3.Connection, scheme: str, as_of: str | None
) -> sqlite3.Row | None:
    if not scheme or not as_of:
        return None
    return conn.execute(
        """
        SELECT expense_ratio, pe FROM fundamentals
        WHERE scheme_code = ? AND as_of = ?
        """,
        (scheme, as_of),
    ).fetchone()


def _top_holdings(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    for line in lines:
        isin = line["isin"]
        name = line["name"]
        key = ("isin", isin) if isin else ("name", name)
        if key not in merged:
            merged[key] = {"isin": isin, "name": name, "weight": 0.0}
        merged[key]["weight"] += line["weight"]
    ranked = sorted(merged.values(), key=lambda h: (-h["weight"], h["name"] or ""))
    return ranked[:TOP_N]


def _sum_by(
    lines: list[dict[str, Any]], field: str, missing_label: str
) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for line in lines:
        label = line[field] or missing_label
        out[label] += line["weight"]
    return dict(out)


def _credit(lines: list[dict[str, Any]]) -> tuple[dict[str, float] | None, str | None]:
    debt = [line for line in lines if line["asset_class"] == "debt"]
    if not debt:
        return None, CREDIT_NOTE_NO_DEBT
    out: dict[str, float] = defaultdict(float)
    for line in debt:
        out[_rating_bucket(line["rating"])] += line["weight"]
    return dict(out), None


def _rating_bucket(rating: str | None) -> str:
    if not rating:
        return "Unrated"
    parts = [p for p in re.split(r"[\s/|]+", rating.strip().upper()) if p]
    token = parts[-1] if parts else ""
    if token.startswith("AAA"):
        return "AAA"
    if token.startswith("AA"):
        return "AA"
    if token.startswith("A"):
        return "A"
    if token.startswith("BBB"):
        return "BBB"
    if token.startswith(("BB", "B", "CCC", "CC", "C", "D")):
        return "Below BBB"
    return "Unrated"


def _equity_split(lines: list[dict[str, Any]]) -> dict[str, float]:
    out = {bucket: 0.0 for bucket in EQUITY_BUCKETS}
    for line in lines:
        if line["asset_class"] != "equity":
            continue
        bucket = (line["market_cap_bucket"] or "unclassified").lower()
        if bucket not in out:
            bucket = "unclassified"
        out[bucket] += line["weight"]
    return out


def _avg_known(
    pairs: list[tuple[float, float]], n_constituents: int
) -> tuple[float | None, bool]:
    if not pairs:
        return None, True
    total_w = sum(w for w, _ in pairs)
    if total_w == 0:
        return None, True
    avg = sum(w * v for w, v in pairs) / total_w
    return avg, len(pairs) < n_constituents
