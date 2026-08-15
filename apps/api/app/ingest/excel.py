from __future__ import annotations

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

    rows: list[dict[str, Any]] = []
    for row in ws.iter_rows(min_row=header_idx + 1, values_only=True):
        if row is None or all(_is_blank(c) for c in row):
            continue
        rec: dict[str, Any] = {}
        for col_idx, key in mapping.items():
            val = row[col_idx] if col_idx < len(row) else None
            rec[key] = _coerce(key, val)
        if _row_has_payload(rec):
            rows.append(rec)
    return rows


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
    if "rating" in h:
        return _FIELD_RATING
    if "industry" in h or "sector" in h:
        return _FIELD_SECTOR
    if "asset" in h:
        return _FIELD_ASSET
    if "market_cap" in h or "market cap" in h:
        return _FIELD_MCAP
    if "%" in h or "weight" in h:
        return _FIELD_WEIGHT
    if h == "nav" or h.endswith(" nav"):
        return _FIELD_WEIGHT
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
