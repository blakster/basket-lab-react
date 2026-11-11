# Filings Status and Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically refresh missing or stale official filings, preserve usable cached holdings, expose per-scheme ingestion status, and show filing coverage and retry controls in Insights.

**Architecture:** SQLite records a stable per-scheme filing attempt independently from `holdings`. The ingestion layer returns structured results rather than swallowing download, mapping, or parsing failures; FastAPI exposes those results together with each insights response. React uses cached insights immediately, triggers a bounded ensure request, refetches once, and renders coverage/provenance plus an explicit retry for non-current schemes.

**Tech Stack:** Python 3/FastAPI/httpx/sqlite3/openpyxl; React 18/TypeScript/TanStack Query/Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-16-filings-status-and-insights-design.md`

## Global Constraints

- Use official AMC/AMFI disclosure sources only; do not invent data or ratings.
- Preserve existing holdings when a refresh fails and label partial coverage honestly.
- Opening Insights must not wait for an AMC download before rendering cached data.
- Automatically request at most one ensure operation per active scheme set at a time; manual retry is one additional explicit request.
- Do not add scheduling, paper trading, accounts, or brokerage execution.
- Keep the existing salmon-newsprint letterpress design and accessible busy/status copy.

---

## File structure

- `apps/api/app/db.py` — schema for persisted filing attempts.
- `apps/api/app/ingest/amc_fetch.py` — typed AMC discovery/download result with source and failure category.
- `apps/api/app/ingest/ensure.py` — per-scheme ensure orchestration, freshness checks, and status persistence.
- `apps/api/app/main.py` — structured `/api/ingest/ensure` and `/api/insights` responses.
- `apps/api/app/insights.py` — attaches filing coverage to each returned basket without changing holdings math.
- `apps/api/tests/test_ensure_filings.py` and new `apps/api/tests/test_filing_status.py` — storage, failure, stale, and endpoint-facing behavior.
- `apps/web/src/lib/api/insights.ts` — TypeScript API contracts and ensure result parsing.
- `apps/web/src/components/InsightsPanel.tsx` — non-blocking refresh, coverage/provenance, and retry action.
- `apps/web/src/components/InsightsPanel.test.tsx` — automatic refresh, status rendering, retry, and partial coverage behavior.
- `apps/web/src/index.css` — compact status block styles within the existing visual language.

### Task 1: Persist and query filing attempt status

**Files:**
- Modify: `apps/api/app/db.py`
- Create: `apps/api/app/filing_status.py`
- Create: `apps/api/tests/test_filing_status.py`

**Interfaces:**
- Produces: `FilingState = Literal["fresh", "stale", "missing-source", "download-failed", "parse-failed", "unmapped"]`.
- Produces: `record_filing_status(conn, status: FilingStatus) -> None` and `filing_statuses(conn, scheme_codes: list[str], month: str) -> dict[str, FilingStatus]`.
- `FilingStatus` contains `scheme_code`, `state`, `requested_month`, `attempted_at`, `finished_at`, `as_of`, `amc`, `source_url`, and `reason`.

- [ ] **Step 1: Write the failing status-storage tests**

```python
def test_filing_status_round_trips_source_and_reason(db):
    record_filing_status(db, FilingStatus(
        scheme_code="118741", state="download-failed", requested_month="2026-08",
        attempted_at="2026-08-16T00:00:00+00:00", finished_at="2026-08-16T00:00:01+00:00",
        as_of=None, amc="Nippon India Mutual Fund", source_url="https://amc.example/portfolio.xls",
        reason="connection timed out",
    ))
    assert filing_statuses(db, ["118741"], "2026-08")["118741"].reason == "connection timed out"

def test_existing_holdings_are_stale_not_missing_when_month_is_newer(db):
    # seed 2026-07 holding for 118741
    assert filing_statuses(db, ["118741"], "2026-08")["118741"].state == "stale"
```

- [ ] **Step 2: Run the tests and verify they fail because the module and table do not exist**

Run: `cd apps/api && pytest tests/test_filing_status.py -v`

Expected: FAIL with an import/schema failure naming `filing_status`.

- [ ] **Step 3: Add the table and minimal query module**

```python
CREATE TABLE IF NOT EXISTS filing_status (
  scheme_code TEXT NOT NULL, requested_month TEXT NOT NULL, state TEXT NOT NULL,
  attempted_at TEXT NOT NULL, finished_at TEXT, as_of TEXT, amc TEXT,
  source_url TEXT, reason TEXT,
  PRIMARY KEY (scheme_code, requested_month)
);
```

Implement `FilingStatus` as a frozen dataclass. `filing_statuses` returns a stored status when available; otherwise it derives `fresh` or `stale` from the latest `holdings.as_of`, and returns `unmapped` only when no holding and no stored attempt exists.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `cd apps/api && pytest tests/test_filing_status.py -v`

Expected: PASS.

- [ ] **Step 5: Commit the storage layer**

```bash
git add apps/api/app/db.py apps/api/app/filing_status.py apps/api/tests/test_filing_status.py
git commit -m "feat: persist filing ingestion status"
```

### Task 2: Return per-scheme results from ingestion

**Files:**
- Modify: `apps/api/app/ingest/amc_fetch.py`
- Modify: `apps/api/app/ingest/ensure.py`
- Modify: `apps/api/tests/test_ensure_filings.py`

**Interfaces:**
- Consumes: `FilingStatus`, `record_filing_status`, and `filing_statuses` from Task 1.
- Produces: `FetchResult(files: list[Path], source_url: str | None, failure: str | None)`.
- Produces: `ensure_filings(...) -> dict[str, object]` with `filings: list[FilingStatus]`; preserves compatibility keys `fetched`, `missing`, and `amcs`.

- [ ] **Step 1: Write failing ensure tests for source and parse failures**

```python
def test_ensure_records_download_failure_for_each_affected_scheme(db, tmp_path, monkeypatch):
    monkeypatch.setattr("app.ingest.ensure.fetch_amc_portfolio", lambda *_: FetchResult([], "https://amc.example/xls", "download-failed"))
    result = ensure_filings(db, ["118741"], month="2026-08", incoming=tmp_path, master=master)
    assert result["filings"][0]["state"] == "download-failed"
    assert result["filings"][0]["sourceUrl"] == "https://amc.example/xls"

def test_ensure_keeps_existing_holding_when_download_fails(db, tmp_path, monkeypatch):
    # seed a July holding, request August, force failure
    assert result["filings"][0]["state"] == "stale"
```

- [ ] **Step 2: Run the focused tests and verify they fail on the missing result contract**

Run: `cd apps/api && pytest tests/test_ensure_filings.py -v`

Expected: FAIL because `FetchResult`/`filings` do not exist.

- [ ] **Step 3: Implement structured fetch and ensure behavior**

```python
@dataclass(frozen=True)
class FetchResult:
    files: list[Path]
    source_url: str | None = None
    failure: str | None = None
```

Make `fetch_amc_portfolio` distinguish `missing-source`, `download-failed`, and a successful download. In `ensure_filings`, load one master; record `unmapped` if an input scheme has no AMC; run ingestion once per downloaded AMC; classify a downloaded-but-unjoined file as `parse-failed`; finally derive `fresh`/`stale` from holdings and serialize each status with camelCase API keys.

- [ ] **Step 4: Run focused ingestion tests and verify they pass**

Run: `cd apps/api && pytest tests/test_ensure_filings.py tests/test_filing_status.py -v`

Expected: PASS.

- [ ] **Step 5: Commit ingestion results**

```bash
git add apps/api/app/ingest/amc_fetch.py apps/api/app/ingest/ensure.py apps/api/tests/test_ensure_filings.py
git commit -m "feat: report filing ingestion outcomes"
```

### Task 3: Include filing coverage in Insights API payloads

**Files:**
- Modify: `apps/api/app/insights.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/tests/test_filing_status.py`

**Interfaces:**
- Consumes: `filing_statuses(conn, codes, month)` from Task 1 and ensure response from Task 2.
- Produces: `compute_insights(..., filings_by_code: dict[str, FilingStatus])` basket payload with `filings`, `filingCoverage`, and `filingAsOf`.

- [ ] **Step 1: Write a failing API-shape test**

```python
def test_insights_marks_partial_filing_coverage(db):
    payload = compute_insights(db, {
        "baskets": [{"id": "core", "funds": [
            {"schemeCode": "covered", "weight": 60},
            {"schemeCode": "missing", "weight": 40},
        ]}],
    })
    basket = payload["baskets"][0]
    assert basket["filingCoverage"] == {"covered": 1, "total": 2}
    assert basket["filings"][1]["state"] in {"unmapped", "missing-source"}
```

- [ ] **Step 2: Run it to verify it fails on absent coverage fields**

Run: `cd apps/api && pytest tests/test_filing_status.py::test_insights_marks_partial_filing_coverage -v`

Expected: FAIL with `KeyError: 'filingCoverage'`.

- [ ] **Step 3: Attach source-aware status without changing exposure math**

Pass the target month from `main.py` to `ensure_filings`, obtain statuses after it settles, and pass them into `compute_insights`. For each basket, preserve `missingSchemes`, add ordered per-fund `filings`, count `fresh` and `stale` statuses with actual usable holdings as covered, and use the latest covered `as_of` as `filingAsOf`. Do not fill missing weights with zero in any holding/mix calculation.

- [ ] **Step 4: Run backend tests and verify they pass**

Run: `cd apps/api && pytest tests -v`

Expected: PASS.

- [ ] **Step 5: Commit the API contract**

```bash
git add apps/api/app/insights.py apps/api/app/main.py apps/api/tests/test_filing_status.py
git commit -m "feat: expose filing coverage in insights"
```

### Task 4: Render automatic refresh, coverage, and retry controls

**Files:**
- Modify: `apps/web/src/lib/api/insights.ts`
- Modify: `apps/web/src/components/InsightsPanel.tsx`
- Modify: `apps/web/src/components/InsightsPanel.test.tsx`
- Modify: `apps/web/src/index.css`

**Interfaces:**
- Consumes: API `FilingStatus` with `schemeCode`, `state`, `asOf`, `sourceUrl`, and `reason`.
- Produces: `ensureFilings(schemeCodes: string[]): Promise<EnsureFilingsResponse>` and an Insights `Filing coverage` region with a `Fetch latest filings` button.

- [ ] **Step 1: Write the failing UI tests**

```tsx
it("renders cached insights before the automatic filing refresh settles", async () => {
  ensureFilingsMock.mockReturnValue(new Promise(() => {}));
  postInsightsMock.mockResolvedValue(partialFiling);
  renderPanel();
  expect(await screen.findByText("1 of 2 funds covered")).toBeInTheDocument();
});

it("offers a retry with the stored failure reason", async () => {
  postInsightsMock.mockResolvedValue(failedFiling);
  renderPanel();
  expect(await screen.findByRole("button", { name: "Fetch latest filings" })).toBeInTheDocument();
  expect(screen.getByText("connection timed out")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused UI test and verify it fails**

Run: `cd apps/web && npm test -- InsightsPanel.test.tsx`

Expected: FAIL because the existing query awaits `ensureFilings` before requesting insights and no coverage region exists.

- [ ] **Step 3: Implement the non-blocking query flow and status region**

Split cached `postInsights(active)` from the ensure mutation: load the former immediately; when Insights opens, trigger a deduplicated ensure request and refetch insights on settlement. Use a `useMutation` for the explicit retry. Add the compact status region ahead of holdings with coverage, actual date, per-fund names/states/reasons, and a disabled `Fetching latest filings` button while active. Keep source URLs as visible links only when supplied by the API.

- [ ] **Step 4: Style and verify the focused UI tests pass**

Run: `cd apps/web && npm test -- InsightsPanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the web experience**

```bash
git add apps/web/src/lib/api/insights.ts apps/web/src/components/InsightsPanel.tsx apps/web/src/components/InsightsPanel.test.tsx apps/web/src/index.css
git commit -m "feat: show filing coverage and retry"
```

### Task 5: Verify end-to-end behavior

**Files:**
- Modify only if verification exposes a testable defect in Tasks 1–4.

**Interfaces:**
- Consumes: completed API and UI contracts from Tasks 1–4.

- [ ] **Step 1: Run full automated verification**

Run:

```bash
cd apps/api && pytest tests -v
cd apps/web && npm test
cd apps/web && npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Manually verify the two status paths**

Run the local API and Vite app, open an Insights sheet with one fixture-backed fund and one unavailable fund, and verify: cached holdings render immediately; the unavailable fund shows a reason; **Fetch latest filings** is available; risk metrics still render when filing data is absent. Repeat with a mocked/downloaded current filing and verify the button disappears after a `fresh` result.

- [ ] **Step 3: Record any verification defect before fixing it**

If verification exposes a defect, add a focused failing test to the task that
owns the affected interface, run it to confirm the failure, make the minimal
fix, rerun the complete verification commands, and commit that task's exact
source and test files with `fix: correct filings status verification issue`.
Do not create a verification commit when no defect exists.
