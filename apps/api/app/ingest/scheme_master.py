from __future__ import annotations

import csv
import io
import re
from calendar import monthrange
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import httpx

TIGZIG_LATEST = "https://api.tigzig.com/mf/v1/download?format=latest"
CACHE_NAME = "scheme_master_latest.csv"


def month_end(month: str) -> str:
    year_s, mon_s = month.split("-", 1)
    year, mon = int(year_s), int(mon_s)
    day = monthrange(year, mon)[1]
    return f"{year:04d}-{mon:02d}-{day:02d}"


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


@dataclass(frozen=True)
class SchemeRow:
    scheme_code: str
    scheme_name: str
    isin: str
    amc: str = ""
    scheme_plan: str = ""
    scheme_option: str = ""
    is_active: bool = True
    isin2: str = ""


class SchemeMaster:
    def __init__(self, rows: list[SchemeRow]):
        self._rows = rows
        self._by_code: dict[str, SchemeRow] = {}
        self._by_isin: dict[str, str] = {}
        self._by_name: dict[str, list[SchemeRow]] = {}
        for row in rows:
            self._by_code[row.scheme_code] = row
            if row.isin:
                self._by_isin[row.isin.upper()] = row.scheme_code
            if row.isin2:
                self._by_isin[row.isin2.upper()] = row.scheme_code
            key = _norm(row.scheme_name)
            if key:
                self._by_name.setdefault(key, []).append(row)

    @classmethod
    def from_rows(cls, raw: Iterable[dict[str, Any]]) -> SchemeMaster:
        rows: list[SchemeRow] = []
        for item in raw:
            code = str(item.get("scheme_code") or "").strip()
            name = str(item.get("scheme_name") or "").strip()
            isin = str(item.get("isin") or "").strip()
            isin2 = str(item.get("isin2") or "").strip()
            amc = str(item.get("amc") or "").strip()
            if not code:
                continue
            active = str(item.get("is_active") or "true").strip().lower() not in {
                "false",
                "0",
                "no",
            }
            rows.append(
                SchemeRow(
                    scheme_code=code,
                    scheme_name=name,
                    isin=isin,
                    amc=amc,
                    scheme_plan=str(item.get("scheme_plan") or "").strip(),
                    scheme_option=str(item.get("scheme_option") or "").strip(),
                    is_active=active,
                    isin2=isin2,
                )
            )
        return cls(rows)

    @classmethod
    def from_csv_text(cls, text: str) -> SchemeMaster:
        reader = csv.DictReader(io.StringIO(text))
        return cls.from_rows(reader)

    @classmethod
    def load_cached(cls, cache_dir: Path, *, fetch: bool = True) -> SchemeMaster:
        path = Path(cache_dir) / CACHE_NAME
        if path.exists():
            return cls.from_csv_text(path.read_text(encoding="utf-8", errors="replace"))
        if not fetch:
            return cls([])
        response = httpx.get(TIGZIG_LATEST, follow_redirects=True, timeout=60.0)
        response.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(response.text, encoding="utf-8")
        return cls.from_csv_text(response.text)

    def by_code(self, code: str) -> SchemeRow | None:
        return self._by_code.get(str(code).strip())

    def lookup(
        self,
        *,
        scheme_isin: str | None = None,
        scheme_name: str | None = None,
    ) -> str | None:
        if scheme_isin:
            hit = self._by_isin.get(scheme_isin.strip().upper())
            if hit:
                return hit
        if not scheme_name:
            return None
        key = _norm(scheme_name)
        if not key:
            return None
        tokens = [t for t in key.split() if t not in {"fund", "an", "a", "the", "of"}]
        prefix = " ".join(tokens[:6])
        pool: list[SchemeRow] = list(self._by_name.get(key) or [])
        for name, rows in self._by_name.items():
            if key in name or name in key or (prefix and prefix in name):
                pool.extend(rows)
        if not pool:
            return None
        # de-dupe by code
        uniq = {row.scheme_code: row for row in pool}
        return _prefer_direct_growth(list(uniq.values())).scheme_code

    def direct_counterpart(self, scheme_code: str) -> SchemeRow | None:
        row = self.by_code(scheme_code)
        if row is None or _effective_plan(row) == "direct":
            return None
        key = _family_key(row.scheme_name)
        option = _effective_option(row)
        candidates = [
            candidate
            for candidate in self._rows
            if candidate.is_active
            and candidate.scheme_code != row.scheme_code
            and _effective_plan(candidate) == "direct"
            and _effective_option(candidate) == option
            and _family_key(candidate.scheme_name) == key
        ]
        if not candidates:
            return None
        return min(candidates, key=lambda candidate: candidate.scheme_code)


def _tokens(text: str) -> list[str]:
    return _norm(text).split()


def _effective_plan(row: SchemeRow) -> str:
    plan = row.scheme_plan.strip().lower()
    if plan in {"direct", "regular"}:
        return plan
    tokens = _tokens(row.scheme_name)
    if "direct" in tokens:
        return "direct"
    if "regular" in tokens:
        return "regular"
    return plan


def _effective_option(row: SchemeRow) -> str:
    option = row.scheme_option.strip().lower()
    if option:
        return option
    tokens = set(_tokens(row.scheme_name))
    if "idcw" in tokens or "dividend" in tokens:
        return "idcw"
    if "bonus" in tokens:
        return "bonus"
    if "growth" in tokens:
        return "growth"
    return "other"


# Plan wrappers disappear from the family key. Payout/reinvestment and the
# IDCW frequency stay: they are different cashflow options, not wrapper words.
_FAMILY_WRAPPER_WORDS = {
    "direct",
    "regular",
    "plan",
    "option",
    "growth",
    "idcw",
    "dividend",
    "cumulative",
}


def _family_key(name: str) -> str:
    return " ".join(
        token for token in _tokens(name) if token not in _FAMILY_WRAPPER_WORDS
    )


def _prefer_direct_growth(rows: list[SchemeRow]) -> SchemeRow:
    def score(row: SchemeRow) -> tuple[int, int, int, int, str]:
        name = _norm(row.scheme_name)
        return (
            1 if "direct" in name else 0,
            1 if "growth" in name else 0,
            0 if "bonus" in name else 1,
            0 if "idcw" in name or "dividend" in name else 1,
            row.scheme_code,
        )

    return max(rows, key=score)


def join_scheme_codes(
    rows: list[dict[str, Any]],
    master: SchemeMaster,
    *,
    month: str,
) -> list[dict[str, Any]]:
    as_of = month_end(month)
    out: list[dict[str, Any]] = []
    for raw in rows:
        rec = dict(raw)
        if not rec.get("as_of"):
            rec["as_of"] = as_of
        code = str(rec.get("scheme_code") or "").strip()
        if not code:
            code = (
                master.lookup(
                    scheme_isin=str(rec.get("scheme_isin") or "") or None,
                    scheme_name=str(rec.get("scheme_name") or "") or None,
                )
                or ""
            )
        rec["scheme_code"] = code
        if not rec["scheme_code"]:
            continue
        if rec.get("weight_pct") is None:
            continue
        rec.setdefault("instrument_name", rec.get("instrument_name") or "")
        rec.setdefault("asset_class", None)
        rec.setdefault("sector", None)
        rec.setdefault("rating", None)
        rec.setdefault("market_cap_bucket", None)
        rec.setdefault("isin", rec.get("isin"))
        out.append(rec)
    return out
