from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.filing_status import FilingStatus, filing_statuses, record_filing_status
from app.ingest.amc_fetch import fetch_amc_portfolio, missing_scheme_codes
from app.ingest.run import run_ingest
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
    incoming: Path,
    master: SchemeMaster | None,
) -> dict[str, Any]:
    month = month or datetime.now(timezone.utc).strftime("%Y-%m")
    codes = list(dict.fromkeys(str(code).strip() for code in scheme_codes if str(code).strip()))
    existing = filing_statuses(conn, codes, month)
    pending = [code for code in codes if existing[code].state != "fresh"]

    outcomes: dict[str, tuple[str, str | None, str | None, str | None]] = {}
    by_amc: dict[str, list[str]] = {}
    for code in pending:
        if master is None:
            outcomes[code] = ("missing-source", None, None, "scheme master unavailable")
            continue
        row = master.by_code(code)
        amc = (row.amc if row else "") or ""
        if not amc:
            outcomes[code] = ("unmapped", None, None, "scheme has no AMC mapping")
            continue
        by_amc.setdefault(amc, []).append(code)

    fetched = 0
    amcs: list[str] = []
    for amc, amc_codes in by_amc.items():
        got = fetch_amc_portfolio(amc, month, incoming)
        if got.failure:
            for code in amc_codes:
                outcomes[code] = (got.failure, amc, got.source_url, got.failure)
            continue
        if got.files:
            fetched += len(got.files)
            amcs.append(amc)
            run_ingest(
                conn,
                month=month,
                files=got.files,
                notes="ensure-filings",
                master=master,
            )
        for code in amc_codes:
            outcomes[code] = (
                "parse-failed",
                amc,
                got.source_url,
                "downloaded filing did not join to scheme",
            )

    now = datetime.now(timezone.utc).isoformat()
    statuses: list[FilingStatus] = []
    for code in codes:
        if code not in pending:
            statuses.append(existing[code])
            continue
        row = conn.execute(
            "SELECT MAX(as_of) AS as_of FROM holdings WHERE scheme_code = ?", (code,)
        ).fetchone()
        as_of = row["as_of"]
        state, amc, source_url, reason = outcomes.get(code, ("unmapped", None, None, None))
        if as_of:
            state = "fresh" if as_of.startswith(month) else "stale"
        status = FilingStatus(
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
        record_filing_status(conn, status)
        statuses.append(status)

    return {
        "fetched": fetched,
        "missing": missing_scheme_codes(conn, codes),
        "amcs": amcs,
        "filings": [_serialize_status(status) for status in statuses],
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
