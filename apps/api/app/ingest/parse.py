import csv
import io
import sqlite3
from typing import Any

REQUIRED_HEADERS = (
    "as_of",
    "scheme_code",
    "isin",
    "instrument_name",
    "asset_class",
    "sector",
    "rating",
    "market_cap_bucket",
    "weight_pct",
)


def parse_holdings_csv(text: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError("CSV has no header row")
    headers = [h.strip() for h in reader.fieldnames]
    missing = [h for h in REQUIRED_HEADERS if h not in headers]
    if missing:
        raise ValueError(f"missing required CSV headers: {missing}")

    rows: list[dict[str, Any]] = []
    for i, raw in enumerate(reader, start=2):
        stripped: dict[str, str] = {}
        for orig_k, v in raw.items():
            if orig_k is None:
                continue
            key = orig_k.strip()
            stripped[key] = v.strip() if isinstance(v, str) else ("" if v is None else str(v))

        scheme_code = stripped.get("scheme_code") or ""
        if not scheme_code:
            raise ValueError(f"row {i}: missing scheme_code")

        weight_raw = stripped.get("weight_pct") or ""
        try:
            weight_pct = float(weight_raw)
        except (TypeError, ValueError) as e:
            raise ValueError(f"row {i}: non-numeric weight_pct: {weight_raw!r}") from e

        def empty_to_none(key: str) -> str | None:
            val = stripped.get(key) or ""
            return val if val else None

        out: dict[str, Any] = {
            "as_of": stripped.get("as_of") or "",
            "scheme_code": scheme_code,
            "isin": empty_to_none("isin"),
            "instrument_name": stripped.get("instrument_name") or "",
            "asset_class": empty_to_none("asset_class"),
            "sector": empty_to_none("sector"),
            "rating": empty_to_none("rating"),
            "market_cap_bucket": empty_to_none("market_cap_bucket"),
            "weight_pct": weight_pct,
        }
        # Optional pe / expense columns if present; empty → None
        if "pe" in stripped:
            pe = stripped["pe"]
            out["pe"] = float(pe) if pe else None
        if "expense" in stripped:
            expense = stripped["expense"]
            out["expense"] = float(expense) if expense else None

        rows.append(out)
    return rows


def load_fundamentals(conn: sqlite3.Connection, as_of: str, scheme_code: str, **fields) -> None:
    conn.execute(
        """
        INSERT INTO fundamentals (as_of, scheme_code, expense_ratio, pe, aum_cr, turnover)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(as_of, scheme_code) DO UPDATE SET
          expense_ratio = COALESCE(excluded.expense_ratio, fundamentals.expense_ratio),
          pe = COALESCE(excluded.pe, fundamentals.pe),
          aum_cr = COALESCE(excluded.aum_cr, fundamentals.aum_cr),
          turnover = COALESCE(excluded.turnover, fundamentals.turnover)
        """,
        (
            as_of,
            scheme_code,
            fields.get("expense_ratio"),
            fields.get("pe"),
            fields.get("aum_cr"),
            fields.get("turnover"),
        ),
    )
    conn.commit()


def load_holdings(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    seen: set[tuple[str, str]] = set()
    for r in rows:
        key = (str(r["as_of"]), str(r["scheme_code"]))
        if key in seen:
            continue
        seen.add(key)
        conn.execute(
            "DELETE FROM holdings WHERE as_of = ? AND scheme_code = ?",
            key,
        )
    merged: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for r in rows:
        key = (
            str(r["as_of"]),
            str(r["scheme_code"]),
            str(r.get("isin") or ""),
            str(r.get("instrument_name") or ""),
        )
        if key not in merged:
            merged[key] = dict(r)
        else:
            merged[key]["weight_pct"] = float(merged[key]["weight_pct"]) + float(
                r["weight_pct"]
            )
    rows = list(merged.values())
    sql = """
    INSERT INTO holdings (
      as_of, scheme_code, isin, instrument_name,
      asset_class, sector, rating, market_cap_bucket, weight_pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    params = [
        (
            r["as_of"],
            r["scheme_code"],
            r["isin"],
            r["instrument_name"],
            r["asset_class"],
            r["sector"],
            r["rating"],
            r["market_cap_bucket"],
            r["weight_pct"],
        )
        for r in rows
    ]
    conn.executemany(sql, params)
    conn.commit()
    return len(rows)
