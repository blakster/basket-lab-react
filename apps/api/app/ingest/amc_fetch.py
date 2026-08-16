from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

# Official AMC / AMFI disclosure pages (Excel listings). Not third-party research sites.
AMC_PAGES: dict[str, list[str]] = {
    "PPFAS Mutual Fund": [
        "https://amc.ppfas.com/downloads/portfolio-disclosure/",
    ],
    "Nippon India Mutual Fund": [
        "https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures",
    ],
    "HDFC Mutual Fund": [
        "https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio",
    ],
    "SBI Mutual Fund": [
        "https://www.sbimf.com/en-us/portfolios",
    ],
    "ICICI Prudential Mutual Fund": [
        "https://www.icicipruamc.com/downloads/portfolio-details",
    ],
    "Axis Mutual Fund": [
        "https://www.axismf.com/statutory-disclosures",
    ],
    "Kotak Mahindra Mutual Fund": [
        "https://www.kotakmf.com/Information/portfolios",
    ],
    "DSP Mutual Fund": [
        "https://www.dspim.com/mandatory-disclosures/portfolio-disclosures",
    ],
    "Aditya Birla Sun Life Mutual Fund": [
        "https://mutualfund.adityabirlacapital.com/forms-and-downloads/portfolios",
    ],
    "Mirae Asset Mutual Fund": [
        "https://www.miraeassetmf.co.in/downloads/portfolio",
    ],
    "Tata Mutual Fund": [
        "https://www.tatamutualfund.com/downloads/portfolio",
    ],
    "UTI Mutual Fund": [
        "https://www.utimf.com/statutory-disclosures",
    ],
    "Invesco Mutual Fund": [
        "https://www.invescomutualfund.com/literature",
    ],
    "Bandhan Mutual Fund": [
        "https://bandhanmutual.com/downloads/portfolios",
    ],
    "Sundaram Mutual Fund": [
        "https://www.sundarammutual.com/Statutory-Disclosures",
    ],
}

_HREF = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.I)
_FILE = re.compile(r"\.(xlsx|xlsm|xls|zip)(?:$|\?)", re.I)
_SKIP = re.compile(r"fortnight|fort-night|risk.?param|factsheet|\.pdf", re.I)
_MONTHLY = re.compile(r"monthly|portfolio|scheme_portfolio|scheme-portfolio", re.I)
_UA = "BasketLab/1.0 (local filings ingest; +https://github.com/abhimanyu003/basket-lab)"


@dataclass(frozen=True)
class FetchResult:
    files: list[Path]
    source_url: str | None = None
    failure: str | None = None


def missing_scheme_codes(conn: sqlite3.Connection, codes: list[str]) -> list[str]:
    wanted = [str(c).strip() for c in codes if str(c).strip()]
    if not wanted:
        return []
    placeholders = ",".join("?" * len(wanted))
    have = {
        row[0]
        for row in conn.execute(
            f"SELECT DISTINCT scheme_code FROM holdings WHERE scheme_code IN ({placeholders})",
            wanted,
        )
    }
    return [c for c in wanted if c not in have]


def pick_latest_monthly_url(urls: list[str], *, month: str | None = None) -> str | None:
    cands = [u for u in urls if _FILE.search(u) and not _SKIP.search(u)]
    if not cands:
        return None
    monthly = [u for u in cands if _MONTHLY.search(u)]
    pool = monthly or cands
    if month:
        requested = _requested_year_month(month)
        if requested:
            dated = [u for u in pool if _url_year_month(u) is not None]
            matching = [u for u in dated if _url_year_month(u) == requested]
            if dated and not matching:
                return None
            if matching:
                pool = matching
    return max(pool, key=_url_recency)


def _requested_year_month(month: str) -> tuple[int, int] | None:
    try:
        year_s, month_s = month.split("-", 1)
        year, mon = int(year_s), int(month_s)
    except (AttributeError, ValueError):
        return None
    return (year, mon) if 1 <= mon <= 12 else None


def _url_year_month(url: str) -> tuple[int, int] | None:
    year, month, _, _ = _url_recency(url)
    return (year, month) if year and month else None


def _url_recency(url: str) -> tuple[int, int, int, str]:
    text = url.lower()
    year = 0
    month = 0
    day = 0
    y = re.search(r"(20\d{2})", text)
    if y:
        year = int(y.group(1))
    months = (
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
        "jan",
        "feb",
        "mar",
        "apr",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
    )
    for i, name in enumerate(months, start=1):
        if re.search(rf"\b{name}\b", text) or f"-{name}" in text or f"_{name}" in text:
            month = ((i - 1) % 12) + 1
            break
    d = re.search(r"\b(\d{1,2})[-_.](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)", text)
    if d:
        day = int(d.group(1))
    ym = re.search(r"(20\d{2})[-_.](\d{1,2})", text)
    if ym and year == 0:
        year, month = int(ym.group(1)), int(ym.group(2))
    # 31-July-26
    short = re.search(r"(20)?(\d{2})(?=\.xls)", text)
    if year == 0 and short:
        year = 2000 + int(short.group(2))
    return (year, month, day, url)


def fetch_amc_portfolio(amc: str, month: str, dest: Path) -> FetchResult:
    pages = AMC_PAGES.get(amc) or []
    if not pages:
        return FetchResult([], failure="missing-source")
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    found: list[str] = []
    page_error = False
    for page in pages:
        try:
            resp = httpx.get(
                page,
                follow_redirects=True,
                timeout=30.0,
                headers={"User-Agent": _UA},
            )
            resp.raise_for_status()
        except Exception:
            page_error = True
            continue
        for href in _HREF.findall(resp.text):
            if _FILE.search(href):
                found.append(urljoin(page, href))
    url = pick_latest_monthly_url(found, month=month)
    if not url:
        return FetchResult(
            [],
            pages[0] if pages else None,
            "download-failed" if page_error else "missing-source",
        )
    try:
        file_resp = httpx.get(
            url,
            follow_redirects=True,
            timeout=90.0,
            headers={"User-Agent": _UA},
        )
        file_resp.raise_for_status()
    except Exception:
        return FetchResult([], url, "download-failed")
    name = Path(urlparse(url).path).name or f"{amc.replace(' ', '-')}-{month}.xlsx"
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    path = dest / name
    path.write_bytes(file_resp.content)
    if path.suffix.lower() == ".zip":
        files = _unzip_excels(path, dest)
        return FetchResult(files, url, None if files else "parse-failed")
    return FetchResult([path], url)


def _unzip_excels(archive: Path, dest: Path) -> list[Path]:
    import zipfile

    out: list[Path] = []
    try:
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                if info.is_dir() or not _FILE.search(info.filename):
                    continue
                if _SKIP.search(info.filename):
                    continue
                target = dest / Path(info.filename).name
                target.write_bytes(zf.read(info))
                out.append(target)
    except zipfile.BadZipFile:
        return []
    return out
