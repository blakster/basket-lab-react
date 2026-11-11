from __future__ import annotations

import argparse
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

from app.db import init_db
from app.ingest.excel import sheet_to_csv_rows
from app.ingest.parse import load_holdings, parse_holdings_csv
from app.ingest.scheme_master import CACHE_NAME, SchemeMaster, join_scheme_codes

AMFI_PORTFOLIO_URL = "https://www.amfiindia.com/online-center/portfolio-disclosure"
REPO_ROOT = Path(__file__).resolve().parents[4]
DB_PATH = REPO_ROOT / "data" / "basket.sqlite"
INCOMING_DIR = REPO_ROOT / "data" / "incoming"
FIXTURE_CSV = REPO_ROOT / "fixtures" / "holdings" / "sample.csv"

_FILE_EXT = (".xls", ".xlsx", ".xlsm", ".csv")


def run_ingest(
    conn: sqlite3.Connection,
    *,
    month: str,
    files: list[Path],
    notes: str | None = None,
    master: SchemeMaster | None = None,
) -> dict:
    started_at = datetime.now(timezone.utc).isoformat()
    files_ok = 0
    files_failed = 0
    if master is not None:
        joiner = master
    else:
        cache = REPO_ROOT / "data" / CACHE_NAME
        if cache.exists():
            joiner = SchemeMaster.from_csv_text(
                cache.read_text(encoding="utf-8", errors="replace")
            )
        else:
            joiner = SchemeMaster.from_rows([])

    for path in files:
        try:
            rows = rows_from_path(Path(path))
            rows = join_scheme_codes(rows, joiner, month=month)
            if not rows:
                raise ValueError(f"{Path(path).name}: no rows with scheme_code")
            load_holdings(conn, rows)
            files_ok += 1
        except Exception:
            files_failed += 1

    finished_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO ingest_runs (
          started_at, finished_at, month, files_ok, files_failed, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (started_at, finished_at, month, files_ok, files_failed, notes),
    )
    conn.commit()
    return {
        "month": month,
        "files_ok": files_ok,
        "files_failed": files_failed,
        "notes": notes,
    }


def download_amfi_month(month: str, dest: Path, *, force: bool = False) -> list[Path]:
    if not force and os.environ.get("AMFI_INGEST") != "1":
        return []

    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    try:
        response = httpx.get(AMFI_PORTFOLIO_URL, follow_redirects=True, timeout=30.0)
        response.raise_for_status()
    except Exception:
        return []

    urls = _amfi_file_urls(response.text, month=month)
    if not urls:
        return []

    saved: list[Path] = []
    for url in urls:
        try:
            file_resp = httpx.get(url, follow_redirects=True, timeout=60.0)
            file_resp.raise_for_status()
            name = Path(urlparse(url).path).name or "amfi-download"
            path = dest / name
            path.write_bytes(file_resp.content)
            saved.append(path)
        except Exception:
            continue
    return saved


def resolve_ingest_files(
    *,
    month: str,
    source: str | None = None,
    incoming: Path | None = None,
) -> tuple[list[Path], str | None]:
    if source == "fixture":
        return [FIXTURE_CSV], None

    dest = incoming if incoming is not None else INCOMING_DIR
    if source == "amfi" or os.environ.get("AMFI_INGEST") == "1":
        paths = download_amfi_month(month, dest, force=source == "amfi")
        notes = "amfi-listing-unparsed" if not paths else None
        return paths, notes

    if dest.is_dir():
        found: list[Path] = []
        for ext in ("*.csv", "*.xlsx", "*.xlsm", "*.xls"):
            found.extend(dest.glob(ext))
        return sorted(found), None
    return [], None


def rows_from_path(path: Path) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return parse_holdings_csv(path.read_text(encoding="utf-8"))
    if suffix in {".xlsx", ".xlsm", ".xls"} or _looks_like_xlsx(path):
        return _rows_from_excel(path)
    raise ValueError(f"unsupported ingest file: {path.name}")


def _looks_like_xlsx(path: Path) -> bool:
    try:
        return path.read_bytes()[:2] == b"PK"
    except OSError:
        return False


def _rows_from_excel(path: Path) -> list[dict]:
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True, read_only=True)
    try:
        index = _sheet_index_names(wb)
        merged: list[dict] = []
        for ws in wb.worksheets:
            rows = sheet_to_csv_rows(ws)
            if not rows:
                continue
            mapped = index.get((ws.title or "").strip())
            if mapped:
                for rec in rows:
                    rec["scheme_name"] = mapped
            merged.extend(rows)
        if merged:
            return merged
    finally:
        wb.close()
    raise ValueError(f"{path.name}: holdings headers not found")


def _sheet_index_names(wb) -> dict[str, str]:
    out: dict[str, str] = {}
    for ws in wb.worksheets:
        title = (ws.title or "").strip().lower()
        if title not in {"index", "contents", "index sheet"}:
            continue
        for row in ws.iter_rows(values_only=True):
            if not row or row[0] is None:
                continue
            code = str(row[0]).strip()
            name = ""
            for cell in row[1:]:
                if cell and str(cell).strip():
                    name = str(cell).split("(")[0].strip()
                    break
            if code and name:
                out[code] = name
        break
    return out


def _amfi_file_urls(html: str, *, month: str) -> list[str]:
    hrefs = re.findall(r"""href\s*=\s*["']([^"']+)["']""", html, flags=re.I)
    if not hrefs:
        return []

    file_urls: list[str] = []
    for href in hrefs:
        path = urlparse(href).path.lower()
        if path.endswith(_FILE_EXT):
            file_urls.append(urljoin(AMFI_PORTFOLIO_URL, href))
    if not file_urls:
        return []

    month_tokens = _month_tokens(month)
    matched = [u for u in file_urls if any(tok in u.lower() for tok in month_tokens)]
    return matched or file_urls


def _month_tokens(month: str) -> list[str]:
    tokens = {month.lower(), month.replace("-", "").lower()}
    try:
        year, mon = month.split("-", 1)
        dt = datetime(int(year), int(mon), 1)
        tokens.add(dt.strftime("%b-%Y").lower())
        tokens.add(dt.strftime("%b%Y").lower())
        tokens.add(dt.strftime("%B-%Y").lower())
        tokens.add(dt.strftime("%B%Y").lower())
    except (TypeError, ValueError):
        pass
    return [t for t in tokens if t]


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest holdings CSVs into SQLite")
    parser.add_argument("--month", required=True, help="Filing month YYYY-MM")
    parser.add_argument("--source", default=None, help='Use "fixture" for sample.csv')
    args = parser.parse_args()

    conn = init_db(DB_PATH)
    try:
        files, notes = resolve_ingest_files(month=args.month, source=args.source)
        master = None
        if args.source != "fixture":
            try:
                master = SchemeMaster.load_cached(DB_PATH.parent)
            except Exception:
                master = None
        result = run_ingest(
            conn, month=args.month, files=files, notes=notes, master=master
        )
        print(result)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
