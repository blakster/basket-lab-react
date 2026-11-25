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
        self._by_isin: dict[str, list[str]] = {}
        self._by_name: dict[str, list[SchemeRow]] = {}
        self._direct_candidates: dict[tuple[str, str], list[SchemeRow]] = {}
        for row in rows:
            self._by_code[row.scheme_code] = row
            if row.isin:
                self._by_isin.setdefault(row.isin.upper(), []).append(row.scheme_code)
            if row.isin2:
                self._by_isin.setdefault(row.isin2.upper(), []).append(row.scheme_code)
            key = _norm(row.scheme_name)
            if key:
                self._by_name.setdefault(key, []).append(row)
            if row.is_active and _effective_plan(row) == "direct":
                direct_key = (_family_key(row.scheme_name), _effective_option(row))
                self._direct_candidates.setdefault(direct_key, []).append(row)

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
            raw_active = item.get("is_active")
            active = (
                raw_active
                if isinstance(raw_active, bool)
                else str(raw_active if raw_active is not None else "true").strip().lower()
                not in {"false", "0", "no"}
            )
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
            hits = self._by_isin.get(scheme_isin.strip().upper()) or []
            if hits:
                if len(hits) == 1 or not scheme_name:
                    return hits[-1]
                rows = [self._by_code[hit] for hit in hits]
                name_key = _norm(scheme_name)
                exact = [row for row in rows if _norm(row.scheme_name) == name_key]
                if len(exact) == 1:
                    return exact[0].scheme_code
                partial = [
                    row
                    for row in rows
                    if name_key and (name_key in _norm(row.scheme_name) or _norm(row.scheme_name) in name_key)
                ]
                if len(partial) == 1:
                    return partial[0].scheme_code
                return hits[-1]
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
        amc = _norm(row.amc)
        candidates = [
            candidate
            for candidate in self._direct_candidates.get((key, option), [])
            if candidate.scheme_code != row.scheme_code and _norm(candidate.amc) == amc
        ]
        if len(candidates) != 1:
            return None
        return candidates[0]


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


# Plan markers disappear only when they are wrapper words around the plan
# option. A word such as Regular inside a fund name (Regular Savings Fund)
# is part of the fund family and must survive.
def _family_key(name: str) -> str:
    text = re.sub(r"\b(?:direct|regular)\s+plan\b", " ", (name or "").lower())
    text = re.sub(
        r"(?:^|[-–—(])\s*(?:direct|regular|plan)\s*(?=$|[-–—)])",
        " ",
        text,
    )
    tokens = _tokens(text)
    option_words = {
        "plan",
        "growth",
        "idcw",
        "dividend",
        "income",
        "bonus",
        "option",
        "monthly",
        "weekly",
        "daily",
        "quarterly",
        "semi",
        "half",
        "yearly",
        "annual",
        "annually",
        "payout",
        "reinvestment",
        "institutional",
        "retail",
    }
    kept = []
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else ""
        following = tokens[index + 1] if index + 1 < len(tokens) else ""
        if token in {"direct", "regular"} and (not following or following in option_words):
            continue
        if token == "plan" and (previous in option_words or following in option_words):
            continue
        if token in {"option", "growth", "idcw", "dividend", "cumulative"}:
            continue
        kept.append(token)
    return " ".join(kept)


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
