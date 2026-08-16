# User Filing Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach an AMC portfolio workbook to any Insights fund, store only SQLite rows, and show AUM, turnover, cash/TREPS, and stock-level overlap.

**Architecture:** Multipart `POST /api/ingest/upload` writes a temp file, reuses the Excel/CSV parser, stamps the request `schemeCode`, replaces that scheme’s holdings, upserts `fundamentals.aum_cr` / `turnover`, then deletes the temp file. Insights reads each scheme’s own latest `as_of` and adds per-fund AUM/turnover plus `overlapHoldings`. The coverage list gets **Add filing** on every fund.

**Tech Stack:** Python 3 / FastAPI / openpyxl / sqlite3; React 18 / TypeScript / Vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-user-filing-upload-design.md`

## Global Constraints

- Official AMC files only (`.xlsx`, `.xls`, `.xlsm`, `.csv`); no PDF in this release.
- Never invent PE, expense, QVM, ratings, or zeros for missing fields.
- 5 MiB cap; delete the temp file in `finally` even on parse failure.
- Stamp every row with the request `schemeCode`; do not trust sheet titles as AMFI codes.
- Replace all prior `holdings` for that scheme on success; leave other schemes untouched.
- Failed upload must not clear last-good holdings.
- `reason` is `user upload`; `source_url` is null.
- Keep the salmon letterpress Insights desk; **Add filing** is an outlined square button.
- Copy: `Use an AMC portfolio file under 5 MB (.xlsx, .xls, or .csv).` / `No holdings table in this file.` / `Could not read this filing.` / `Upload failed.` / `Reading filing`.

---

## File structure

- `apps/api/app/db.py` — add nullable `aum_cr` and `turnover` on `fundamentals`; migrate existing DBs.
- `apps/api/app/ingest/excel.py` — banner `as_of`, cash-like rows, AUM, turnover.
- `apps/api/app/ingest/parse.py` — `load_fundamentals`; `replace_scheme_holdings`.
- `apps/api/app/ingest/upload.py` — `upload_filing(conn, scheme_code, path, *, month) -> FilingStatus`.
- `apps/api/app/main.py` — `POST /api/ingest/upload`.
- `apps/api/app/insights.py` — per-scheme latest `as_of`; `aumCr` / `turnover`; `overlapHoldings`.
- `apps/api/tests/test_excel.py` — ICICI-shaped fixture parse.
- `apps/api/tests/test_upload_filing.py` — upload endpoint and replace rules.
- `apps/api/tests/test_insights.py` — overlap names and per-fund metrics.
- `apps/web/src/lib/api/insights.ts` — `uploadFiling`, `OverlapName` types.
- `apps/web/src/components/InsightsPanel.tsx` — **Add filing** per fund; overlap table.
- `apps/web/src/components/InsightsPanel.test.tsx` — upload UX tests.
- `apps/web/src/index.css` — compact filing-row action styles.

### Task 1: Parse AUM, turnover, cash lines, and as-of banner

**Files:**
- Modify: `apps/api/app/db.py`
- Modify: `apps/api/app/ingest/excel.py`
- Modify: `apps/api/app/ingest/parse.py`
- Modify: `apps/api/tests/test_excel.py`

**Interfaces:**
- Consumes: existing `sheet_to_csv_rows(ws)`.
- Produces: `sheet_to_csv_rows` still returns holding dicts; each cash-like row has `asset_class` of `treps` or `cash` and a percent `weight_pct`. New `extract_sheet_metrics(ws) -> dict` with keys `as_of: str | None`, `aum_cr: float | None`, `turnover: float | None`. New `load_fundamentals(conn, as_of, scheme_code, *, aum_cr=None, turnover=None, pe=None, expense_ratio=None) -> None` upserts `fundamentals`. `init_db` ensures `fundamentals.aum_cr` and `fundamentals.turnover` exist.

- [ ] **Step 1: Write the failing parser tests**

Add to `apps/api/tests/test_excel.py`:

```python
from openpyxl import Workbook
from app.ingest.excel import extract_sheet_metrics, sheet_to_csv_rows


def _icici_like_book(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "FLEXCAP"
    ws["A1"] = "ICICI Prudential Mutual Fund"
    ws["A2"] = "ICICI Prudential Flexicap Fund"
    ws["A3"] = "Portfolio as on Jul 31,2026"
    headers = [
        "Company/Issuer/Instrument Name", "ISIN", "Coupon", "Industry/Rating",
        "Quantity", "Exposure/Market Value(Rs.Lakh)", "% to Nav",
    ]
    for col, h in enumerate(headers, start=1):
        ws.cell(4, col, h)
    ws["A5"] = "Equity & Equity Related Instruments"
    ws["G5"] = 0.9677
    ws["A8"] = "TVS Motor Company Ltd."
    ws["B8"] = "INE494B01023"
    ws["D8"] = "Automobiles"
    ws["G8"] = 0.10057
    ws["A9"] = "TREPS"
    ws["F9"] = 63730.28
    ws["G9"] = 0.02644
    ws["A10"] = "Cash Margin - Derivatives"
    ws["G10"] = 0.00189
    ws["A11"] = "Total Net Assets"
    ws["F11"] = 2409978.38
    ws["G11"] = 1.0
    ws["A12"] = "6. Portfolio turnover Ratio "
    ws["B12"] = "0.26 times"
    wb.save(path)
    return path


def test_icici_sheet_extracts_holdings_cash_and_metrics(tmp_path):
    from openpyxl import load_workbook
    path = _icici_like_book(tmp_path / "icici.xlsx")
    ws = load_workbook(path, data_only=True)["FLEXCAP"]
    rows = sheet_to_csv_rows(ws)
    names = {r["instrument_name"] for r in rows}
    assert "TVS Motor Company Ltd." in names
    assert "Equity & Equity Related Instruments" not in names
    treps = next(r for r in rows if r["instrument_name"] == "TREPS")
    assert treps["asset_class"] == "treps"
    assert 2.6 < treps["weight_pct"] < 2.7
    cash = next(r for r in rows if "Cash Margin" in r["instrument_name"])
    assert cash["asset_class"] == "cash"
    metrics = extract_sheet_metrics(ws)
    assert metrics["as_of"] == "2026-07-31"
    assert 24099 < metrics["aum_cr"] < 24101
    assert metrics["turnover"] == 0.26
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd apps/api && pytest tests/test_excel.py::test_icici_sheet_extracts_holdings_cash_and_metrics -v`

Expected: FAIL on missing `extract_sheet_metrics` or cash rows dropped.

- [ ] **Step 3: Implement parser + schema**

In `excel.py`:

- After mapping a row, if the name matches `treps`, `tri-party`, `cblo`, or `reverse repo` (case-insensitive), set `asset_class` to `treps`. If it matches `cash` or `cash margin`, set `asset_class` to `cash`. Keep these rows even with a null ISIN.
- Do not treat `Total Net Assets` as a holding (`_is_section_row` / `_keep_holding`).
- `extract_sheet_metrics(ws)`: scan all cells as text. Parse `Portfolio as on Jul 31,2026` (allow missing space after comma) with `datetime.strptime` variants into `YYYY-MM-DD`. When a row’s first cell is `Total Net Assets`, take the first numeric cell ≥ 1000 as ₹ lakh and divide by 100 for `aum_cr`. When a cell contains `portfolio turnover`, parse the first float as `turnover`.

In `db.py` `init_db`, after `executescript(SCHEMA)`, add columns if missing:

```python
cols = {row[1] for row in conn.execute("PRAGMA table_info(fundamentals)")}
if "aum_cr" not in cols:
    conn.execute("ALTER TABLE fundamentals ADD COLUMN aum_cr REAL")
if "turnover" not in cols:
    conn.execute("ALTER TABLE fundamentals ADD COLUMN turnover REAL")
conn.commit()
```

Also add those columns to the `CREATE TABLE` in `SCHEMA`.

In `parse.py`:

```python
def load_fundamentals(conn, as_of: str, scheme_code: str, **fields) -> None:
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
            as_of, scheme_code,
            fields.get("expense_ratio"), fields.get("pe"),
            fields.get("aum_cr"), fields.get("turnover"),
        ),
    )
    conn.commit()
```

- [ ] **Step 4: Re-run the focused test**

Run: `cd apps/api && pytest tests/test_excel.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/db.py apps/api/app/ingest/excel.py apps/api/app/ingest/parse.py apps/api/tests/test_excel.py
git commit -m "feat: extract AUM, turnover, and cash lines from AMC sheets"
```

### Task 2: Upload endpoint that replaces one scheme

**Files:**
- Create: `apps/api/app/ingest/upload.py`
- Create: `apps/api/tests/test_upload_filing.py`
- Modify: `apps/api/app/ingest/parse.py`
- Modify: `apps/api/app/main.py`

**Interfaces:**
- Consumes: `sheet_to_csv_rows`, `extract_sheet_metrics`, `rows_from_path`, `load_holdings`, `load_fundamentals`, `record_filing_status`, `FilingStatus`.
- Produces: `replace_scheme_holdings(conn, scheme_code: str) -> None` deletes `DELETE FROM holdings WHERE scheme_code = ?`. `upload_filing(conn, scheme_code: str, path: Path, *, month: str) -> FilingStatus`. `POST /api/ingest/upload` multipart `schemeCode` + `file`, optional `month`.

- [ ] **Step 1: Write failing upload tests**

```python
from datetime import datetime, timezone
from pathlib import Path

from app.ingest.parse import load_holdings, parse_holdings_csv
from app.ingest.upload import upload_filing


def test_upload_stamps_scheme_and_replaces_old_month(db, tmp_path):
    load_holdings(db, parse_holdings_csv(
        "as_of,scheme_code,isin,instrument_name,asset_class,sector,rating,market_cap_bucket,weight_pct\n"
        "2026-01-31,148401,INEOLD,Old Name,equity,Banks,,,10\n"
    ))
    from tests.test_excel import _icici_like_book
    path = _icici_like_book(tmp_path / "flex.xlsx")
    status = upload_filing(db, "148401", path, month="2026-07")
    assert status.scheme_code == "148401"
    assert status.as_of == "2026-07-31"
    assert status.state == "fresh"
    assert status.reason == "user upload"
    assert status.source_url is None
    old = db.execute("SELECT COUNT(*) FROM holdings WHERE scheme_code='148401' AND as_of='2026-01-31'").fetchone()[0]
    assert old == 0
    tvs = db.execute(
        "SELECT weight_pct FROM holdings WHERE scheme_code='148401' AND isin='INE494B01023'"
    ).fetchone()
    assert tvs is not None
    funda = db.execute(
        "SELECT aum_cr, turnover FROM fundamentals WHERE scheme_code='148401'"
    ).fetchone()
    assert funda["turnover"] == 0.26


def test_post_upload_rejects_pdf_and_keeps_holdings(client, db, tmp_path):
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF-1.4 junk")
    prior = db.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
    res = client.post(
        "/api/ingest/upload",
        data={"schemeCode": "122639"},
        files={"file": ("x.pdf", pdf.read_bytes(), "application/pdf")},
    )
    assert res.status_code == 422
    assert "5 MB" in res.json()["message"] or "xlsx" in res.json()["message"].lower()
    assert db.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == prior


def test_post_upload_empty_table_is_422(client, tmp_path):
    from openpyxl import Workbook
    path = tmp_path / "empty.xlsx"
    wb = Workbook()
    wb.active["A1"] = "hello"
    wb.save(path)
    res = client.post(
        "/api/ingest/upload",
        data={"schemeCode": "122639"},
        files={"file": ("empty.xlsx", path.read_bytes(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 422
    assert res.json()["error"] == "parse-failed"
    assert res.json()["message"] == "No holdings table in this file."
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `cd apps/api && pytest tests/test_upload_filing.py -v`

Expected: FAIL on missing `app.ingest.upload`.

- [ ] **Step 3: Implement replace + upload**

```python
# parse.py
def replace_scheme_holdings(conn, scheme_code: str) -> None:
    conn.execute("DELETE FROM holdings WHERE scheme_code = ?", (scheme_code,))
    conn.commit()
```

```python
# upload.py
ALLOWED = {".xlsx", ".xls", ".xlsm", ".csv"}
MAX_BYTES = 5 * 1024 * 1024

def upload_filing(conn, scheme_code: str, path: Path, *, month: str) -> FilingStatus:
    from app.filing_status import FilingStatus, record_filing_status
    from app.ingest.excel import extract_sheet_metrics
    from app.ingest.parse import load_fundamentals, load_holdings, replace_scheme_holdings
    from app.ingest.run import rows_from_path
    from openpyxl import load_workbook

    suffix = path.suffix.lower()
    if suffix not in ALLOWED or path.stat().st_size > MAX_BYTES:
        raise ValueError("Use an AMC portfolio file under 5 MB (.xlsx, .xls, or .csv).")
    rows = rows_from_path(path)
    metrics = {"as_of": None, "aum_cr": None, "turnover": None}
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        wb = load_workbook(path, data_only=True, read_only=True)
        try:
            for name in wb.sheetnames:
                extra = extract_sheet_metrics(wb[name])
                for key in metrics:
                    if extra.get(key) is not None:
                        metrics[key] = extra[key]
        finally:
            wb.close()
    if not rows:
        raise FileNotFoundError("No holdings table in this file.")
    as_of = metrics["as_of"] or next((r.get("as_of") for r in rows if r.get("as_of")), None)
    if not as_of:
        as_of = f"{month}-01"
    for rec in rows:
        rec["scheme_code"] = scheme_code
        rec["as_of"] = as_of
    replace_scheme_holdings(conn, scheme_code)
    load_holdings(conn, rows)
    load_fundamentals(conn, as_of, scheme_code, aum_cr=metrics["aum_cr"], turnover=metrics["turnover"])
    state = "fresh" if str(as_of).startswith(month) else "stale"
    now = datetime.now(timezone.utc).isoformat()
    status = FilingStatus(
        scheme_code=scheme_code, state=state, requested_month=month,
        attempted_at=now, finished_at=now, as_of=as_of, amc=None,
        source_url=None, reason="user upload",
    )
    record_filing_status(conn, status)
    return status
```

In `main.py`:

```python
@app.post("/api/ingest/upload")
async def post_ingest_upload(request: Request):
    form = await request.form()
    scheme = str(form.get("schemeCode") or "").strip()
    upload = form.get("file")
    month = str(form.get("month") or datetime.now(timezone.utc).strftime("%Y-%m"))
    if not scheme or upload is None or not hasattr(upload, "read"):
        return JSONResponse(status_code=422, content={"error": "bad_request", "message": "schemeCode and file required"})
    data = await upload.read()
    name = getattr(upload, "filename", "") or "upload.bin"
    suffix = Path(name).suffix.lower()
    if suffix not in {".xlsx", ".xls", ".xlsm", ".csv"} or len(data) > 5 * 1024 * 1024:
        return JSONResponse(
            status_code=422,
            content={"error": "bad_request", "message": "Use an AMC portfolio file under 5 MB (.xlsx, .xls, or .csv)."},
        )
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(data)
        tmp.close()
        status = upload_filing(request.app.state.db, scheme, Path(tmp.name), month=month)
    except FileNotFoundError as exc:
        return JSONResponse(status_code=422, content={"error": "parse-failed", "message": str(exc)})
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"error": "bad_request", "message": str(exc)})
    except Exception:
        return JSONResponse(status_code=422, content={"error": "parse-failed", "message": "Could not read this filing."})
    finally:
        Path(tmp.name).unlink(missing_ok=True)
    from app.ingest.ensure import _serialize_status
    return _serialize_status(status)
```

Raise `FileNotFoundError("No holdings table in this file.")` from `upload_filing` when `rows` is empty so the 422 message matches the spec exactly.

- [ ] **Step 4: Run upload tests**

Run: `cd apps/api && pytest tests/test_upload_filing.py tests/test_excel.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/ingest/upload.py apps/api/app/ingest/parse.py apps/api/app/main.py apps/api/tests/test_upload_filing.py
git commit -m "feat: upload AMC filing for one scheme"
```

### Task 3: Insights AUM, turnover, and stock overlap

**Files:**
- Modify: `apps/api/app/insights.py`
- Modify: `apps/api/tests/test_insights.py`

**Interfaces:**
- Consumes: `fundamentals.aum_cr`, `fundamentals.turnover`, per-scheme holdings.
- Produces: each basket payload adds `aumCr: float | None`, `turnover: float | None` from the first (only) covered scheme when the Insights desk is focused per basket — actually each basket already aggregates funds. Spec: per-fund metrics live on the basket object today as single PE/expense averages. Add `aumCr` / `turnover` as the value from the sole fund if the basket has one fund; if several funds have values, use the same `_avg_known` weight-average used for PE, still leaving null when none exist. Also add `fundMetrics: list[{schemeCode, aumCr, turnover}]` so Snapshot can show per-fund columns. Response top-level `overlapHoldings: Record<str, list[{isin, name, weightA, weightB, minWeight}]>` keyed like `overlap`. `_holdings_for(conn, scheme)` uses that scheme’s `MAX(as_of)` so a user-uploaded July file still appears when another scheme’s global max differs.

Use this shape (later tasks depend on it):

```python
fundMetrics: list[dict]  # {schemeCode, aumCr, turnover}
aumCr: float | None       # _avg_known of aum pairs, or None
turnover: float | None
overlapHoldings: dict[str, list[dict]] | None
# each item: {isin, name, weightA, weightB, minWeight}  # max 15, sort minWeight desc
```

- [ ] **Step 1: Write the failing insights test**

```python
def test_insights_include_aum_and_overlap_names(db, client):
    db.execute(
        "INSERT INTO holdings (as_of, scheme_code, isin, instrument_name, asset_class, sector, rating, market_cap_bucket, weight_pct) VALUES (?,?,?,?,?,?,?,?,?)",
        ("2026-07-31", "A", "INE1", "HDFC Bank", "equity", "Banks", None, None, 3.44),
    )
    db.execute(
        "INSERT INTO holdings (as_of, scheme_code, isin, instrument_name, asset_class, sector, rating, market_cap_bucket, weight_pct) VALUES (?,?,?,?,?,?,?,?,?)",
        ("2026-07-31", "B", "INE1", "HDFC Bank", "equity", "Banks", None, None, 0.94),
    )
    db.execute(
        "INSERT INTO fundamentals (as_of, scheme_code, expense_ratio, pe, aum_cr, turnover) VALUES (?,?,?,?,?,?)",
        ("2026-07-31", "A", None, None, 24100.0, 0.26),
    )
    db.commit()
    res = client.post("/api/insights", json={
        "baskets": [
            {"id": "1", "funds": [{"schemeCode": "A", "weight": 100}]},
            {"id": "2", "funds": [{"schemeCode": "B", "weight": 100}]},
        ]
    })
    body = res.json()
    one = next(b for b in body["baskets"] if b["id"] == "1")
    assert one["aumCr"] == 24100.0
    assert one["turnover"] == 0.26
    assert one["fundMetrics"][0]["schemeCode"] == "A"
    names = body["overlapHoldings"]["1|2"]
    assert names[0]["isin"] == "INE1"
    assert names[0]["minWeight"] == 0.94
```

- [ ] **Step 2: Run it and confirm KeyError**

Run: `cd apps/api && pytest tests/test_insights.py::test_insights_include_aum_and_overlap_names -v`

Expected: FAIL `KeyError: 'aumCr'` or `'overlapHoldings'`.

- [ ] **Step 3: Implement**

Change `_holdings_for` to:

```python
def _scheme_as_of(conn, scheme: str) -> str | None:
    row = conn.execute("SELECT MAX(as_of) FROM holdings WHERE scheme_code = ?", (scheme,)).fetchone()
    return row[0] if row is not None else None
```

Use `_scheme_as_of` inside `_roll_basket` per fund instead of the global `as_of` for holdings and fundamentals lookups.

Build `isin_names` alongside `isin_weights`. After pair overlap percent, build `overlapHoldings` from shared ISINs, `min(w_a, w_b)`, top 15.

Attach `aumCr`, `turnover`, `fundMetrics` on each basket from that basket’s funds.

Update `_fundamentals_for` SELECT to include `aum_cr, turnover`.

- [ ] **Step 4: Run insights tests**

Run: `cd apps/api && pytest tests/test_insights.py -v`

Expected: PASS. Existing overlap percent test still passes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/insights.py apps/api/tests/test_insights.py
git commit -m "feat: expose AUM, turnover, and stock overlap"
```

### Task 4: Add filing control and overlap names in Insights

**Files:**
- Modify: `apps/web/src/lib/api/insights.ts`
- Modify: `apps/web/src/components/InsightsPanel.tsx`
- Modify: `apps/web/src/components/InsightsPanel.test.tsx`
- Modify: `apps/web/src/index.css`

**Interfaces:**
- Consumes: `POST /api/ingest/upload`; basket `aumCr`, `turnover`, `fundMetrics`; `overlapHoldings`.
- Produces: `uploadFiling(schemeCode: string, file: File): Promise<FilingStatus>`. Every coverage fund row has **Add filing**. Snapshot columns AUM and Turnover. Overlap table of shared names.

- [ ] **Step 1: Write the failing UI tests**

```tsx
it("offers Add filing on every coverage fund", async () => {
  postInsightsMock.mockResolvedValue(partialFilingWithFilings);
  renderPanel();
  expect(await screen.findAllByRole("button", { name: "Add filing" })).toHaveLength(2);
});

it("shows Reading filing then keeps holdings if upload fails", async () => {
  postInsightsMock.mockResolvedValue(partialFilingWithFilings);
  uploadFilingMock.mockRejectedValue(new Error("Upload failed."));
  renderPanel();
  const input = (await screen.findAllByLabelText("Add filing"))[0] as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], "x.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await userEvent.upload(input, file);
  expect(await screen.findByText("Upload failed.")).toBeInTheDocument();
  expect(screen.getByText("Reliance Industries")).toBeInTheDocument();
});

it("rejects a pdf on the client without calling upload", async () => {
  postInsightsMock.mockResolvedValue(partialFilingWithFilings);
  renderPanel();
  const input = (await screen.findAllByLabelText("Add filing"))[0] as HTMLInputElement;
  const file = new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" });
  await userEvent.upload(input, file);
  expect(await screen.findByText(/under 5 MB/)).toBeInTheDocument();
  expect(uploadFilingMock).not.toHaveBeenCalled();
});
```

Build `partialFilingWithFilings` from the existing two-fund fixture: add `filings` for both codes, `filingCoverage: { covered: 1, total: 2 }`, and one holding named `Reliance Industries`.

Mock `uploadFiling` next to `ensureFilings` / `postInsights`.

- [ ] **Step 2: Run the focused UI test**

Run: `cd apps/web && npm test -- InsightsPanel.test.tsx`

Expected: FAIL — no **Add filing** buttons.

- [ ] **Step 3: Implement client + UI**

`insights.ts`:

```ts
export type OverlapName = {
  isin: string | null;
  name: string;
  weightA: number;
  weightB: number;
  minWeight: number;
};

export type FundMetric = {
  schemeCode: string;
  aumCr: number | null;
  turnover: number | null;
};

// add to InsightsBasket:
// aumCr?: number | null;
// turnover?: number | null;
// fundMetrics?: FundMetric[];

// add to InsightsResponse:
// overlapHoldings?: Record<string, OverlapName[]> | null;

export async function uploadFiling(schemeCode: string, file: File): Promise<FilingStatus> {
  if (file.size > 5 * 1024 * 1024 || !/\.(xlsx|xls|xlsm|csv)$/i.test(file.name)) {
    throw new Error("Use an AMC portfolio file under 5 MB (.xlsx, .xls, or .csv).");
  }
  const body = new FormData();
  body.set("schemeCode", schemeCode);
  body.set("file", file);
  const res = await fetch("/api/ingest/upload", { method: "POST", body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof json.message === "string" && json.message
        ? json.message
        : "Could not read this filing.",
    );
  }
  return json as FilingStatus;
}
```

In `FilingCoverageBlock`, each `<li>` gets a labelled file input + button **Add filing**. `accept=".xlsx,.xls,.xlsm,.csv"`. While that `schemeCode` is uploading: **Reading filing**, `aria-busy`, disable only that control. On client size/type error, set a per-fund error string to the 5 MB copy. On thrown upload, show `error.message`. On success call the existing insights `refetch`. One in-flight upload per scheme.

Snapshot: add AUM and Turnover columns from `filing.aumCr` / `filing.turnover` (or that basket’s `fundMetrics` matching the focused scheme). Format AUM as `₹{n} Cr` or `—`; turnover as `0.26×` or `—`.

`OverlapBlock` accepts `overlapHoldings` and, when the focused pair has names, render a second table: Holding / left % / right %.

Letterpress: reuse `.insight-filings-action` and `.ds-btn-outlined` rules; no radius; no gain/loss on the button.

- [ ] **Step 4: Run web tests**

Run: `cd apps/web && npm test -- InsightsPanel.test.tsx`

Expected: PASS. Then `cd apps/web && npm test` and `cd apps/api && pytest tests -v`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/insights.ts apps/web/src/components/InsightsPanel.tsx apps/web/src/components/InsightsPanel.test.tsx apps/web/src/index.css
git commit -m "feat: add filing upload on every Insights fund"
```

### Task 5: Verify

**Files:** modify only if a testable defect appears.

- [ ] **Step 1: Automated verification**

```bash
cd apps/api && pytest tests -v
cd apps/web && npm test
cd apps/web && npm run build
```

Expected: all exit 0.

- [ ] **Step 2: Browser**

Open Insights, **Add filing** on Flexi Cap with the ICICI July 2026 xlsx. Holdings and TREPS appear; Snapshot shows AUM ≈ ₹24,100 Cr and turnover 0.26×; `/tmp` has no leftover upload. Attach a `.pdf` and confirm the last filing remains.

- [ ] **Step 3: Defect commit only if needed**

Message: `fix: correct filing upload verification issue`.
