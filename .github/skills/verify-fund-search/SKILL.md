---
name: verify-fund-search
description: "Run the TLA+ model of FundSearch dismiss vs in-flight resolve. Use when changing apps/web/src/state/searchRun.ts or FundSearch abort/dismiss."
---

# Verify FundSearch

`searchRun.ts` holds one `SearchSession`. `finishFetch` applies only while that session is `loading` for the same request. `dismissSearch` drops hits and refuses a later resolve for that request.

Harm: Escape or Tab dismisses the list, then a late fetch reopens it and shoves Lock/Delete under the pointer.

## When to run

Edits to `apps/web/src/state/searchRun.ts` or `apps/web/src/components/FundSearch.tsx` abort, dismiss, or fetch completion.

## Command

From the repo root:

```
verify/search/run.sh
```

Must exit 0. TLC checks `DismissedStayClosed` on `FundSearch.tla`. Read every TLC result with `/statechart`.

Replay of pre-a47bf2d resolve-after-dismiss:

```
verify/search/run.sh bug
```

Must exit 12. `FundSearchBug.tla` applies `FinishFetch` for any query that ever started.

If the good spec fails, replay `searchRun.test.ts` "dismissed in-flight resolve" before touching `DismissedStayClosed`.

## Coverage

- Covered: `beginFetch`, `finishFetch`, `failFetch`, `dismissSearch`, `typeQuery`, `armFetch`. Two queries.
- Not covered: debounce delay, AbortController wiring, combobox focus, `reportStatus`.
- Bounds: `Queries == {Q1, Q2}`.
- Sync commit: SYNC_COMMIT_PLACEHOLDER
