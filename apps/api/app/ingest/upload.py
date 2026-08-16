from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.filing_status import FilingStatus, record_filing_status
from app.ingest.excel import extract_sheet_metrics
from app.ingest.parse import load_fundamentals, load_holdings, replace_scheme_holdings
from app.ingest.run import rows_from_path

ALLOWED = {".xlsx", ".xls", ".xlsm", ".csv"}
MAX_BYTES = 5 * 1024 * 1024


def upload_filing(conn, scheme_code: str, path: Path, *, month: str) -> FilingStatus:
    from openpyxl import load_workbook

    suffix = path.suffix.lower()
    if suffix not in ALLOWED or path.stat().st_size > MAX_BYTES:
        raise ValueError("Use an AMC portfolio file under 5 MB (.xlsx, .xls, or .csv).")
    try:
        rows = rows_from_path(path)
    except ValueError:
        rows = []
    metrics: dict[str, object] = {"as_of": None, "aum_cr": None, "turnover": None}
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        wb = load_workbook(path, data_only=True, read_only=True)
        try:
            for name in wb.sheetnames:
                extra = extract_sheet_metrics(wb[name])
                for key in metrics:
                    if extra.get(key) is not None:
                        metrics[key] = extra[key]
        finally:
            wb.close()
    if not rows:
        raise FileNotFoundError("No holdings table in this file.")
    as_of = metrics["as_of"] or next((r.get("as_of") for r in rows if r.get("as_of")), None)
    if not as_of:
        as_of = f"{month}-01"
    for rec in rows:
        rec["scheme_code"] = scheme_code
        rec["as_of"] = as_of
        rec.setdefault("instrument_name", rec.get("instrument_name") or "")
        rec.setdefault("asset_class", None)
        rec.setdefault("sector", None)
        rec.setdefault("rating", None)
        rec.setdefault("market_cap_bucket", None)
        rec.setdefault("isin", rec.get("isin"))
    replace_scheme_holdings(conn, scheme_code)
    load_holdings(conn, rows)
    load_fundamentals(conn, as_of, scheme_code, aum_cr=metrics["aum_cr"], turnover=metrics["turnover"])
    state = "fresh" if str(as_of).startswith(month) else "stale"
    now = datetime.now(timezone.utc).isoformat()
    status = FilingStatus(
        scheme_code=scheme_code, state=state, requested_month=month,
        attempted_at=now, finished_at=now, as_of=as_of, amc=None,
        source_url=None, reason="user upload",
    )
    record_filing_status(conn, status)
    return status
