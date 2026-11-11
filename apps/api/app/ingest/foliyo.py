from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.ingest.parse import load_fundamentals, load_holdings, load_mixes

FOLIYO_URL = "https://mcp.foliyo.ai/markets"
_UA = "BasketLab/1.0 (local insights; +https://github.com/abhimanyu003/basket-lab)"
_SECTIONS = [
    "overview",
    "holdings",
    "asset_allocation",
    "sector_allocation",
    "portfolio_stats",
]


class FoliyoError(Exception):
    def __init__(self, failure: str, reason: str | None = None):
        self.failure = failure
        self.reason = reason
        super().__init__(reason or failure)


@dataclass(frozen=True)
class FoliyoPersist:
    as_of: str
    amc: str | None
    source_url: str | None


def fetch_fund_details(scheme_code: str, *, client: httpx.Client | None = None) -> dict[str, Any]:
    return call_foliyo_tool(
        "get_fund_details",
        {
            "fund": scheme_code,
            "sections": _SECTIONS,
            "holdings_limit": 25,
        },
        client=client,
    )


def call_foliyo_tool(
    name: str,
    arguments: dict[str, Any],
    *,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    http = client or httpx.Client(timeout=30.0)
    owns = client is None
    try:
        res = http.post(
            FOLIYO_URL,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            },
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "User-Agent": _UA,
            },
        )
        res.raise_for_status()
        return rpc_result(res.text)
    except httpx.HTTPError as exc:
        raise FoliyoError("download-failed", "foliyo request failed") from exc
    finally:
        if owns:
            http.close()


def rpc_result(body: str) -> dict[str, Any]:
    payload = _parse_body(body)
    if payload.get("error"):
        raise FoliyoError("download-failed", "foliyo request failed")
    result = payload.get("result") or {}
    if not isinstance(result, dict):
        raise FoliyoError("parse-failed", "foliyo returned no fund details")
    if result.get("isError"):
        text = _error_text(result)
        failure = "unmapped" if "unknown instrument" in text.lower() else "download-failed"
        raise FoliyoError(failure, text or None)
    structured = result.get("structuredContent")
    if not isinstance(structured, dict):
        raise FoliyoError("parse-failed", "foliyo returned no fund details")
    if structured.get("facts_unavailable"):
        raise FoliyoError("missing-source", "foliyo facts unavailable")
    return structured


def persist_fund_details(
    conn, scheme_code: str, payload: dict[str, Any]
) -> FoliyoPersist:
    as_of = _as_of(payload)
    if not as_of:
        raise FoliyoError("parse-failed", "foliyo details have no as_of date")
    holdings = _holding_rows(scheme_code, as_of, payload)
    mixes = _mix_rows(scheme_code, as_of, payload)
    if not holdings and not mixes:
        raise FoliyoError("parse-failed", "foliyo details have no holdings")
    if holdings:
        load_holdings(conn, holdings)
    if mixes:
        load_mixes(conn, mixes)
    overview = payload.get("overview") if isinstance(payload.get("overview"), dict) else {}
    stats = payload.get("portfolio_stats") if isinstance(payload.get("portfolio_stats"), dict) else {}
    load_fundamentals(
        conn,
        as_of,
        scheme_code,
        expense_ratio=_num(overview.get("expense_ratio_pct")),
        pe=_num(stats.get("pe")),
        aum_cr=_num(overview.get("aum_cr")),
    )
    amc = overview.get("fund_house")
    url = payload.get("url")
    return FoliyoPersist(
        as_of=as_of,
        amc=str(amc) if amc else None,
        source_url=str(url) if url else FOLIYO_URL,
    )


def _parse_body(body: str) -> dict[str, Any]:
    text = body.strip()
    if text.startswith("{"):
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    chunks: list[str] = []
    for line in text.splitlines():
        if line.startswith("data:"):
            chunks.append(line[5:].lstrip())
    if not chunks:
        raise FoliyoError("parse-failed", "foliyo returned no fund details")
    data = json.loads("\n".join(chunks))
    return data if isinstance(data, dict) else {}


def _error_text(result: dict[str, Any]) -> str:
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            parts.append(str(item.get("text") or ""))
    return " ".join(parts).strip()


def _as_of(payload: dict[str, Any]) -> str | None:
    for key in ("holdings", "asset_allocation", "sector_allocation", "portfolio_stats"):
        block = payload.get(key)
        if isinstance(block, dict) and block.get("as_of"):
            return str(block["as_of"])
    overview = payload.get("overview")
    if isinstance(overview, dict):
        for key in ("aum_as_of", "expense_ratio_as_of"):
            if overview.get(key):
                return str(overview[key])
    return None


def _holding_rows(scheme: str, as_of: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    block = payload.get("holdings")
    items = block.get("items") if isinstance(block, dict) else None
    if not isinstance(items, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        weight = _num(item.get("weight_pct"))
        if not name or weight is None:
            continue
        sector = str(item.get("sector") or "").strip() or None
        rows.append(
            {
                "as_of": as_of,
                "scheme_code": scheme,
                "isin": None,
                "instrument_name": name,
                "asset_class": None,
                "sector": sector,
                "rating": None,
                "market_cap_bucket": None,
                "weight_pct": weight,
            }
        )
    return rows


def _mix_rows(scheme: str, as_of: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    asset_block = payload.get("asset_allocation")
    by_asset = asset_block.get("by_asset") if isinstance(asset_block, dict) else None
    debt_pct = 0.0
    if isinstance(by_asset, list):
        for item in by_asset:
            mapped = _mix_item(scheme, as_of, "asset", item, _asset_label)
            if mapped:
                rows.append(mapped)
                if mapped["label"] == "debt":
                    debt_pct = mapped["weight_pct"]
        market_cap = asset_block.get("market_cap") if isinstance(asset_block, dict) else None
        if isinstance(market_cap, list):
            for item in market_cap:
                mapped = _mix_item(scheme, as_of, "mcap", item, _mcap_label)
                if mapped:
                    rows.append(mapped)
    sector_block = payload.get("sector_allocation")
    sectors = sector_block.get("items") if isinstance(sector_block, dict) else None
    if isinstance(sectors, list):
        for item in sectors:
            mapped = _mix_item(scheme, as_of, "sector", item, _plain_label)
            if mapped:
                rows.append(mapped)
    stats = payload.get("portfolio_stats")
    credit = stats.get("credit_quality") if isinstance(stats, dict) else None
    if isinstance(credit, list) and debt_pct > 0:
        for item in credit:
            if not isinstance(item, dict):
                continue
            label = _plain_label(item.get("name"))
            share = _num(item.get("weight_pct"))
            if not label or share is None:
                continue
            rows.append(
                {
                    "as_of": as_of,
                    "scheme_code": scheme,
                    "kind": "credit",
                    "label": label,
                    "weight_pct": debt_pct * share / 100.0,
                }
            )
    return rows


def _mix_item(
    scheme: str,
    as_of: str,
    kind: str,
    item: object,
    label_fn,
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    label = label_fn(item.get("name"))
    weight = _num(item.get("weight_pct"))
    if not label or weight is None:
        return None
    return {
        "as_of": as_of,
        "scheme_code": scheme,
        "kind": kind,
        "label": label,
        "weight_pct": weight,
    }


def _asset_label(name: object) -> str | None:
    raw = str(name or "").strip().lower()
    if not raw:
        return None
    if raw.startswith("equity"):
        return "equity"
    if raw.startswith("debt"):
        return "debt"
    if "cash" in raw:
        return "cash"
    return str(name).strip()


def _mcap_label(name: object) -> str | None:
    raw = str(name or "").strip().lower()
    if raw.startswith("large"):
        return "large"
    if raw.startswith("mid"):
        return "mid"
    if raw.startswith("small"):
        return "small"
    return None


def _plain_label(name: object) -> str | None:
    raw = str(name or "").strip()
    return raw or None


def _num(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number
