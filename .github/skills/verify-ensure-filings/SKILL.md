---
name: verify-ensure-filings
description: "Run the TLA+ model of ensure_filings concurrent fetch and sequential persist. Use when changing apps/api/app/ingest/ensure.py, persist_fund_details, or ThreadPool fetch order."
---

# Verify ensure_filings

`ensure.py` `_fetch_all` fetches pending scheme codes concurrently, then `ensure_filings` persists them in pending order on the caller thread. An unexpected `Exception` re-raises at the first pending boom after earlier codes are written. `FoliyoError` is a value and does not abort.

Harm: a later fund is stored after an earlier fetch exploded, or an earlier fund is skipped. Insights then shows the wrong schemes as fresh.

## When to run

Edits to `apps/api/app/ingest/ensure.py`, `persist_fund_details` in `apps/api/app/ingest/foliyo.py`, or any persist loop copied from them.

## Command

From the repo root:

```
verify/ensure/run.sh
```

Must exit 0. TLC checks `AbortAfterEarlier` on `EnsureFilings.tla`. Read every TLC result with `/statechart`.

Replay of pre-cf13d58 `_fetch_all` raising in completion order:

```
verify/ensure/run.sh bug
```

Must exit 12. `EnsureFilingsBug.tla` persists in completion order.

If the good spec fails, replay the path in `test_ensure_unexpected_fetch_error_aborts_after_earlier_persists` before touching `AbortAfterEarlier`.

## Coverage

- Covered: `_fetch_all`, `_fetch_one`, the persist loop in `ensure_filings`. Three codes. `ok` / `foliyo` / `boom`.
- Not covered: SQLite locking, `FETCH_WORKERS = 8`, HTTP, Foliyo payload shape.
- Bounds: `Pending == <<C1, C2, C3>>`.
- Sync commit: b9711d3666e8699b77bf280362ea2f31931ad67c
