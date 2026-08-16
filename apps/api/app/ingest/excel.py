from __future__ import annotations

import re
from datetime import datetime
from typing import Any

# Canonical keys produced for a detected AMC / holdings header row.
_FIELD_ISIN = "isin"
_FIELD_NAME = "instrument_name"
_FIELD_SECTOR = "sector"
_FIELD_RATING = "rating"
_FIELD_WEIGHT = "weight_pct"
_FIELD_SCHEME = "scheme_code"
_FIELD_AS_OF = "as_of"
_FIELD_ASSET = "asset_class"
_FIELD_MCAP = "market_cap_bucket"

_TREPS_TOKENS = ("treps", "tri-party", "cblo", "reverse repo")
_CASH_TOKENS = ("cash margin", "cash")
_AS_OF_PATTERNS = (
    "Portfolio as on %b %d,%Y",
    "Portfolio as on %b %d, %Y",
    "Portfolio as on %B %d,%Y",
    "Portfolio as on %B %d, %Y",
    "as on %b %d,%Y",
    "as on %b %d, %Y",
    "as on %B %d,%Y",
    "as on %B %d, %Y",
)


def sheet_to_csv_rows(ws) -> list[dict[str, Any]] | None:
    """Map an AMC/holdings sheet to canonical row dicts.

    Detects a header row containing ``ISIN`` and (``%`` or ``weight`` or ``NAV``).
    Maps Name / ISIN / Industry / rating / ``% to NAV``. Returns ``None`` if
    those headers are not found (caller marks the file failed).
    """
    header = _find_header(ws)
    if header is None:
        return None
    header_idx, mapping = header
    scheme_name = _scheme_name_from_sheet(ws, header_idx)

    rows: list[dict[str, Any]] = []
    for row in ws.iter_rows(min_row=header_idx + 1, values_only=True):
        if row is None or all(_is_blank(c) for c in row):
            continue
        rec: dict[str, Any] = {}
        for col_idx, key in mapping.items():
            val = row[col_idx] if col_idx < len(row) else None
            rec[key] = _coerce(key, val)
        _apply_cash_asset_class(rec)
        if _is_section_row(rec):
            continue
        if _row_has_payload(rec):
            if scheme_name:
                rec.setdefault("scheme_name", scheme_name)
            rows.append(rec)
    _normalize_weight_units(rows)
    rows = [r for r in rows if _keep_holding(r)]
    title = (getattr(ws, "title", None) or "").strip()
    if title and title.lower() not in {"sheet", "sheet1"}:
        for rec in rows:
            rec.setdefault("scheme_name", title)
    return rows


def extract_sheet_metrics(ws) -> dict[str, Any]:
    """Extract as_of, AUM (₹ cr), and turnover from free-text sheet cells."""
    as_of: str | None = None
    aum_cr: float | None = None
    turnover: float | None = None

    for row in ws.iter_rows(values_only=True):
        if row is None:
            continue
        cells = list(row)
        nonempty = [_cell_text(c) for c in cells if _cell_text(c)]
        label = nonempty[0].lower() if nonempty else ""

        if aum_cr is None and label == "total net assets":
            for cell in cells:
                num = _as_number(cell)
                if num is not None and num >= 1000:
                    aum_cr = num / 100.0
                    break

        for cell in cells:
            text = _cell_text(cell)
            if not text:
                continue
            if as_of is None:
                parsed = _parse_as_of(text)
                if parsed:
                    as_of = parsed
            if turnover is None and "portfolio turnover" in text.lower():
                # Prefer a float from later cells in the same row (e.g. "0.26 times").
                for later in cells:
                    later_text = _cell_text(later)
                    if later_text and later is not cell:
                        found = _first_float(later_text)
                        if found is not None:
                            turnover = found
                            break
                if turnover is None:
                    turnover = _first_float(text)

    return {"as_of": as_of, "aum_cr": aum_cr, "turnover": turnover}


def _find_header(ws) -> tuple[int, dict[int, str]] | None:
    for idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if row is None:
            continue
        texts = [_cell_text(c) for c in row]
        if not _is_header_row(texts):
            continue
        mapping = _map_headers(texts)
        if _FIELD_ISIN in mapping.values() and _FIELD_WEIGHT in mapping.values():
            return idx, mapping
    return None


def _is_header_row(texts: list[str]) -> bool:
    lowered = [t.lower() for t in texts if t]
    if not any("isin" in t for t in lowered):
        return False
    return any(("%" in t or "weight" in t or "nav" in t) for t in lowered)


def _map_headers(texts: list[str]) -> dict[int, str]:
    mapping: dict[int, str] = {}
    used: set[str] = set()
    for i, raw in enumerate(texts):
        key = _header_field(raw)
        if key is None or key in used:
            continue
        mapping[i] = key
        used.add(key)
    return mapping


def _header_field(raw: str) -> str | None:
    h = raw.strip().lower()
    if not h:
        return None
    if "isin" in h:
        return _FIELD_ISIN
    if "scheme_code" in h or h.replace(" ", "_") == "scheme_code" or "scheme code" in h:
        return _FIELD_SCHEME
    if "as_of" in h or h.replace(" ", "_") == "as_of" or h in {"as of", "date"}:
        return _FIELD_AS_OF
    if "industry" in h or "sector" in h:
        return _FIELD_SECTOR
    if "rating" in h:
        return _FIELD_RATING
    if "%" in h or "weight" in h or "net asset" in h:
        return _FIELD_WEIGHT
    if h == "nav" or h.endswith(" nav"):
        return _FIELD_WEIGHT
    if "asset" in h:
        return _FIELD_ASSET
    if "market_cap" in h or "market cap" in h:
        return _FIELD_MCAP
    if "name" in h or "instrument" in h:
        return _FIELD_NAME
    return None


def _coerce(key: str, val: Any) -> Any:
    if key == _FIELD_WEIGHT:
        return _as_weight(val)
    if _is_blank(val):
        return None
    if isinstance(val, str):
        text = val.strip()
        return text if text else None
    return val


def _as_weight(val: Any) -> float | None:
    if _is_blank(val):
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    text = str(val).strip().replace("%", "").replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _scheme_name_from_sheet(ws, header_idx: int) -> str | None:
    best = ""
    for i, row in enumerate(ws.iter_rows(max_row=header_idx, values_only=True), start=1):
        if i >= header_idx:
            break
        for cell in row or ():
            text = _cell_text(cell)
            if len(text) > len(best) and "fund" in text.lower():
                best = text
    if not best:
        return None
    return best.split("(")[0].strip()


def _is_section_row(rec: dict[str, Any]) -> bool:
    name = str(rec.get(_FIELD_NAME) or "").strip().lower()
    if not name:
        return False
    if name == "total net assets" or name.startswith("total net assets"):
        return True
    return name in {
        "sub total",
        "subtotal",
        "total",
        "nil",
        "grand total",
    } or name.startswith("equity") or name.startswith("(a)") or name.startswith("(b)")


def _apply_cash_asset_class(rec: dict[str, Any]) -> None:
    name = str(rec.get(_FIELD_NAME) or "").strip().lower()
    if not name:
        return
    if any(tok in name for tok in _TREPS_TOKENS):
        rec[_FIELD_ASSET] = "treps"
        return
    if any(tok in name for tok in _CASH_TOKENS):
        rec[_FIELD_ASSET] = "cash"


def _parse_as_of(text: str) -> str | None:
    cleaned = " ".join(text.split())
    # Normalize "Jul 31,2026" spacing for pattern attempts.
    candidates = [cleaned, re.sub(r",(\S)", r", \1", cleaned)]
    for candidate in candidates:
        for fmt in _AS_OF_PATTERNS:
            # Match trailing / embedded date phrases by trying full string and suffixes.
            for snippet in _date_snippets(candidate):
                try:
                    return datetime.strptime(snippet, fmt).strftime("%Y-%m-%d")
                except ValueError:
                    continue
    return None


def _date_snippets(text: str) -> list[str]:
    snippets = [text]
    lower = text.lower()
    for marker in ("portfolio as on ", "as on "):
        idx = lower.find(marker)
        if idx >= 0:
            snippets.append(text[idx:])
    return snippets


def _as_number(val: Any) -> float | None:
    if isinstance(val, bool) or val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    text = str(val).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _first_float(text: str) -> float | None:
    match = re.search(r"[-+]?\d*\.?\d+", text.replace(",", ""))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _valid_isin(val: Any) -> bool:
    if val is None or val == "":
        return True
    text = str(val).strip()
    return 9 <= len(text) <= 12 and text[:2].isalpha() and text.replace(" ", "").isalnum()


def _keep_holding(rec: dict[str, Any]) -> bool:
    if not _valid_isin(rec.get(_FIELD_ISIN)):
        return False
    weight = rec.get(_FIELD_WEIGHT)
    if not isinstance(weight, (int, float)) or weight <= 0 or weight > 100:
        return False
    name = str(rec.get(_FIELD_NAME) or "").lower()
    banned = (
        "since inception",
        "total amount",
        "market value of",
        "last 1 year",
        "last 3 year",
        "last 5 year",
        "opening balance",
        "over hedging",
        "gross notional",
        "total net assets",
        "portfolio turnover",
    )
    return not any(token in name for token in banned)


def _normalize_weight_units(rows: list[dict[str, Any]]) -> None:
    weights = [
        r[_FIELD_WEIGHT]
        for r in rows
        if isinstance(r.get(_FIELD_WEIGHT), (int, float)) and _valid_isin(r.get(_FIELD_ISIN))
    ]
    if not weights:
        return
    if 0 < max(weights) <= 1.5:
        for r in rows:
            w = r.get(_FIELD_WEIGHT)
            if isinstance(w, (int, float)):
                r[_FIELD_WEIGHT] = round(w * 100.0, 4)


def _row_has_payload(rec: dict[str, Any]) -> bool:
    return any(
        not _is_blank(rec.get(k))
        for k in (_FIELD_ISIN, _FIELD_NAME, _FIELD_WEIGHT, _FIELD_SCHEME)
    )


def _cell_text(val: Any) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _is_blank(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, str) and not val.strip():
        return True
    return False
