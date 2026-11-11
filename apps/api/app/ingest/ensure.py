from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from app.filing_status import FilingStatus, filing_statuses, record_filing_status
from app.ingest.amc_fetch import missing_scheme_codes
from app.ingest.foliyo import FoliyoError, fetch_fund_details, persist_fund_details
from app.ingest.scheme_master import SchemeMaster


def scheme_codes_from_body(body: dict[str, Any]) -> list[str]:
    codes: list[str] = []
    seen: set[str] = set()
    for basket in body.get("baskets") or []:
        for fund in basket.get("funds") or []:
            code = str(fund.get("schemeCode") or "").strip()
            if code and code not in seen:
                seen.add(code)
                codes.append(code)
    return codes


def ensure_filings(
    conn,
    scheme_codes: list[str],
    *,
    month: str | None = None,
    incoming: Path | None = None,
    master: SchemeMaster | None = None,
    fetch: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    del incoming, master
    month = month or datetime.now(timezone.utc).strftime("%Y-%m")
    codes = list(dict.fromkeys(str(code).strip() for code in scheme_codes if str(code).strip()))
    existing = filing_statuses(conn, codes, month)
    pending = [code for code in codes if existing[code].state != "fresh"]
    fetch_fn = fetch or fetch_fund_details

    outcomes: dict[str, tuple[str, str | None, str | None, str | None]] = {}
    houses: list[str] = []
    fetched = 0
    for code in pending:
        try:
            saved = persist_fund_details(conn, code, fetch_fn(code))
        except FoliyoError as exc:
            outcomes[code] = (exc.failure, None, None, exc.reason)
            continue
        fetched += 1
        if saved.amc:
            houses.append(saved.amc)
        outcomes[code] = ("fresh", saved.amc, saved.source_url, None)

    now = datetime.now(timezone.utc).isoformat()
    statuses: list[FilingStatus] = []
    for code in codes:
        if code not in pending:
            statuses.append(existing[code])
            continue
        statuses.append(_status_for(conn, code, month, now, existing[code], outcomes.get(code)))
        record_filing_status(conn, statuses[-1])

    return {
        "fetched": fetched,
        "missing": missing_scheme_codes(conn, codes),
        "amcs": list(dict.fromkeys(houses)),
        "filings": [_serialize_status(status) for status in statuses],
    }


def _status_for(
    conn,
    code: str,
    month: str,
    now: str,
    previous: FilingStatus,
    outcome: tuple[str, str | None, str | None, str | None] | None,
) -> FilingStatus:
    row = conn.execute(
        "SELECT MAX(as_of) AS as_of FROM holdings WHERE scheme_code = ?", (code,)
    ).fetchone()
    as_of = row["as_of"] if row is not None else None
    state, amc, source_url, reason = outcome or ("unmapped", None, None, None)
    if state != "fresh" and as_of:
        state = "stale"
        amc = amc or previous.amc
        source_url = source_url or previous.source_url
    elif state == "fresh":
        as_of = as_of or previous.as_of
    return FilingStatus(
        scheme_code=code,
        state=state,
        requested_month=month,
        attempted_at=now,
        finished_at=now,
        as_of=as_of,
        amc=amc,
        source_url=source_url,
        reason=reason,
    )


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
