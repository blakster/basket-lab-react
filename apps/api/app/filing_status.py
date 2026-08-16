from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

FilingState = Literal[
    "fresh",
    "stale",
    "missing-source",
    "download-failed",
    "parse-failed",
    "unmapped",
]


@dataclass(frozen=True)
class FilingStatus:
    scheme_code: str
    state: FilingState
    requested_month: str
    attempted_at: str
    finished_at: str | None
    as_of: str | None
    amc: str | None
    source_url: str | None
    reason: str | None


def record_filing_status(conn, status: FilingStatus) -> None:
    conn.execute(
        """
        INSERT INTO filing_status (
            scheme_code, requested_month, state, attempted_at, finished_at, as_of,
            amc, source_url, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scheme_code, requested_month) DO UPDATE SET
            state = excluded.state,
            attempted_at = excluded.attempted_at,
            finished_at = excluded.finished_at,
            as_of = excluded.as_of,
            amc = excluded.amc,
            source_url = excluded.source_url,
            reason = excluded.reason
        """,
        (
            status.scheme_code,
            status.requested_month,
            status.state,
            status.attempted_at,
            status.finished_at,
            status.as_of,
            status.amc,
            status.source_url,
            status.reason,
        ),
    )
    conn.commit()


def filing_statuses(conn, scheme_codes: list[str], month: str) -> dict[str, FilingStatus]:
    if not scheme_codes:
        return {}

    placeholders = ", ".join("?" for _ in scheme_codes)
    stored_rows = conn.execute(
        f"""
        SELECT scheme_code, state, requested_month, attempted_at, finished_at, as_of,
               amc, source_url, reason
        FROM filing_status
        WHERE requested_month = ? AND scheme_code IN ({placeholders})
        """,
        (month, *scheme_codes),
    ).fetchall()
    statuses = {
        row["scheme_code"]: FilingStatus(
            scheme_code=row["scheme_code"],
            state=row["state"],
            requested_month=row["requested_month"],
            attempted_at=row["attempted_at"],
            finished_at=row["finished_at"],
            as_of=row["as_of"],
            amc=row["amc"],
            source_url=row["source_url"],
            reason=row["reason"],
        )
        for row in stored_rows
    }
    missing_codes = [code for code in scheme_codes if code not in statuses]
    if not missing_codes:
        return statuses

    holding_placeholders = ", ".join("?" for _ in missing_codes)
    holding_rows = conn.execute(
        f"""
        SELECT scheme_code, MAX(as_of) AS as_of
        FROM holdings
        WHERE scheme_code IN ({holding_placeholders})
        GROUP BY scheme_code
        """,
        missing_codes,
    ).fetchall()
    latest_as_of = {row["scheme_code"]: row["as_of"] for row in holding_rows}
    for code in missing_codes:
        as_of = latest_as_of.get(code)
        state: FilingState = "unmapped" if as_of is None else (
            "fresh" if as_of.startswith(month) else "stale"
        )
        statuses[code] = FilingStatus(
            scheme_code=code,
            state=state,
            requested_month=month,
            attempted_at="",
            finished_at=None,
            as_of=as_of,
            amc=None,
            source_url=None,
            reason=None,
        )
    return statuses
