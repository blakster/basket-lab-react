# Basket Lab (React) — Design Spec

**Date:** 2026-08-15  
**Status:** Draft for user review  
**Repo:** `/Users/vanshaggarwal/Projects/basket-lab-react`

A React + TypeScript remake of [basket-lab](https://github.com/abhimanyu003/basket-lab): Indian mutual-fund and ETF basket backtesting, plus official-filing insights. Search must stay fast. Insights must never invent numbers.

## 1. Goal

Ship a local web app that:

1. Matches Basket Lab’s core loop: build baskets, set weights to 100%, lumpsum or SIP, period or custom dates, compare CAGR/XIRR/drawdown, charts, yearly ranking, shareable URL.
2. Adds insights: top holdings, sector mix, asset mix, credit rating, equity large/mid/small, portfolio overlap, expense ratio, PE, plus NAV-derived Sharpe/volatility.
3. Includes Indian ETFs as AMFI schemes (same codes as mutual funds).
4. Fixes Basket Lab’s search stall (Fuse.js over the full scheme list on the main thread).

**Success:** typing a fund name stays responsive; a 3-basket 3-year backtest still works offline after the first NAV fetch; every insight field is either a real filing/NAV value or an explicit empty state.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| UI | Vite + React + TypeScript |
| Insights API | FastAPI |
| Store | SQLite file (`data/basket.sqlite`). No Postgres. |
| Search + NAV | TigZig `https://api.tigzig.com/mf/v1` first; MFAPI fallback |
| Holdings source | Monthly AMFI AMC portfolio Excel (our ingest) |
| NAV storage | Browser IndexedDB only. Never SQLite. |
| Baskets | `localStorage` + shareable query string. No accounts. |
| v1 insights | All listed fields. Missing → “not in filing” / “N/A”, never `0`. |
| Hosting v1 | Local: `npm run dev` + `uvicorn` bound to `127.0.0.1`. |
| Client data | TanStack Query (server), React context (baskets/settings), `idb-keyval` (NAV) |
| Charts | Chart.js |

## 3. Out of scope (v1)

- User accounts, saved cloud baskets
- Unofficial Groww / Kuvera / Tickertape APIs
- US or non-AMFI funds
- Live market price vs NAV for ETF premium/discount (optional later via Yahoo)
- Playwright visual suite, coverage gates
- Inventing PE/expense from third-party sites

## 4. Architecture

Two processes. No cloud database.

```
Browser (Vite + React)
  ├─ Search ──────────────► TigZig /mf/v1/search
  ├─ NAV / backtest ──────► TigZig /mf/v1/nav  (+ IndexedDB)
  │                         MFAPI /mf/{code} if TigZig fails
  ├─ Baskets / share URL ─► localStorage + query string
  └─ Insights ────────────► FastAPI
                               └─ SQLite (holdings, rollups, fundamentals)
                                    ▲
                              monthly ingest
                              AMFI AMC Excel
```

**Ownership**

| Number | Born where |
|---|---|
| Search hits | TigZig (MFAPI fallback) |
| NAV, CAGR, XIRR, drawdown, Sharpe, volatility | Browser, from cached NAV |
| Holdings, sector, asset, credit, overlap, expense, PE, equity split | FastAPI + SQLite |

**Rules**

1. Do not download the full scheme list into the browser.
2. Do not run Fuse.js (or any client fuzzy index) over the universe.
3. FastAPI does not serve NAV history.
4. Ingest failure must not break search or backtest (keep last good SQLite snapshot).

## 5. Screens and components

One route: `/`. Shared links are the same page with query params.

**Layout (top → bottom)**

1. Header — title, share, data status  
2. Settings (mode, amount, period) | basket list  
3. Performance table  
4. Growth chart, drawdown chart  
5. Yearly ranking  
6. Insights (new) — scoped to active baskets  
7. Share URL, disclaimer  

**Components**

| Component | Responsibility |
|---|---|
| `AppHeader` | Share action, status line |
| `InvestmentSettings` | Lumpsum/SIP, amount (≥ ₹100), period / custom dates |
| `BasketList` / `BasketCard` | Toggle, edit, duplicate, delete, reset defaults |
| `BasketEditor` | Name, color, weights, locks, 100% rule |
| `FundSearch` | Debounced typeahead against TigZig |
| `BacktestView` | Table, two charts, yearly ranking |
| `InsightsPanel` | All insight cards |
| `ShareBar` | Encode/decode URL |

Pure calc: `src/lib/backtest/`. HTTP wrappers: `src/lib/api/`. No `onclick` handlers on `window`.

## 6. Data flow

### 6.1 Search

1. Debounce 200ms. Minimum 2 characters.
2. `GET https://api.tigzig.com/mf/v1/search?q={q}&limit=20` — no `plan` / `option` filters (they hide some ETFs).
3. Render those rows only.
4. New keystroke aborts the in-flight request.
5. On 429/5xx/timeout: one retry, then MFAPI `GET https://api.mfapi.in/mf/search?q={q}`.
6. Selecting a row adds `{ schemeCode, schemeName, isin }` at weight 0.

Never call `GET https://api.mfapi.in/mf` (full list) from the client.

### 6.2 Backtest

1. Save requires allocation sum 100% ± 0.1.
2. Missing NAVs: TigZig `GET /mf/v1/nav?schemes={codes}&since={start}&to={end}` (≤ 50 codes per call). Fallback: MFAPI per scheme.
3. Persist `{ date, nav }[]` in IndexedDB, key = AMFI scheme code.
4. `backtest(baskets, navMap, mode, amount, range)` is a pure function.
5. Amount/period/mode changes recompute only; no refetch if cache covers the range.
6. URL updates after a successful run: query param `s=` is pako-compressed + base64 of `{ mode, amount, period, customDates, baskets }`.

Lumpsum uses CAGR. SIP uses XIRR (Newton–Raphson, same definition as basket-lab). Max drawdown is peak-to-trough on the portfolio value series.

### 6.3 Insights

`POST /api/insights` with JSON:

```json
{
  "baskets": [
    {
      "id": "1",
      "name": "Core",
      "funds": [
        { "schemeCode": "140084", "weight": 60 },
        { "schemeCode": "122639", "weight": 40 }
      ]
    }
  ]
}
```

Response: per-basket rollups (holdings, sector, asset, credit, equity split, expense, PE) and `overlap` (pairwise matrix). Omit `overlap` when fewer than two baskets have at least one filing. Sharpe/volatility are **not** in this response.

### 6.4 Ingest

`python -m ingest` or `POST /api/ingest` (listen on `127.0.0.1` only).

1. Download current-month AMC Excel from AMFI portfolio disclosure.
2. Parse with per-file schema detection (AMC sheets differ). Reject a file that fails validation; keep other AMCs.
3. Normalize to rows: `as_of`, `scheme_code`, `isin`, `instrument_name`, `asset_class`, `sector`, `rating`, `weight_pct`.
4. Join scheme code ↔ ISIN via a cached TigZig scheme-master snapshot (`/mf/v1/download?format=latest`).
5. Join equity ISINs to the latest AMFI/SEBI market-cap classification list → `large` / `mid` / `small` / `unclassified`.
6. Upsert SQLite. Keep the previous month’s snapshot for “what changed” later; v1 UI uses **current month only**.
7. Fundamentals (`expense_ratio`, `pe`): copy from Excel/AMFI columns **when present**. Otherwise store `NULL`.

Ingest is offline. The app serves the last successful snapshot if this run fails.

## 7. SQLite schema (v1)

```sql
schemes (
  scheme_code TEXT PRIMARY KEY,
  scheme_name TEXT NOT NULL,
  isin TEXT,
  amc TEXT,
  category TEXT,
  is_etf INTEGER NOT NULL DEFAULT 0
);

holdings (
  as_of TEXT NOT NULL,          -- YYYY-MM-DD, month of filing
  scheme_code TEXT NOT NULL,
  isin TEXT,
  instrument_name TEXT NOT NULL,
  asset_class TEXT,             -- equity | debt | gold | cash | other
  sector TEXT,
  rating TEXT,                  -- debt instruments only
  market_cap_bucket TEXT,       -- large | mid | small | unclassified
  weight_pct REAL NOT NULL,
  PRIMARY KEY (as_of, scheme_code, isin, instrument_name)
);

fundamentals (
  as_of TEXT NOT NULL,
  scheme_code TEXT NOT NULL,
  expense_ratio REAL,           -- NULL if not in filing
  pe REAL,                      -- NULL if not in filing
  PRIMARY KEY (as_of, scheme_code)
);

ingest_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  month TEXT NOT NULL,
  files_ok INTEGER NOT NULL,
  files_failed INTEGER NOT NULL,
  notes TEXT
);
```

No NAV table.

## 8. Insight semantics

All percents are **percent of basket NAV**, after collapsing `fund_weight × holding_weight`.

| Insight | Definition | Empty |
|---|---|---|
| Top holdings | Top 10 ISINs by basket weight | No filings → “No AMFI filing” |
| Sector | Sum weights by `sector` | Missing sector → bucket `Unclassified` |
| Asset allocation | Sum by `asset_class` | Same |
| Credit rating | Sum of **debt** weights by `rating` (AAA, AA, A, BBB, Below BBB, Unrated) | No debt → card stays, copy “N/A — no debt holdings” |
| Equity distribution | Sum of **equity** weights by `market_cap_bucket` | Unmapped ISIN → `Unclassified` |
| Overlap | For baskets A, B: `Σ_isin min(w_i,A, w_i,B)` | < 2 baskets with filings → “Add another basket with holdings data” |
| Expense ratio | Basket-weighted average of scheme `expense_ratio` | Any constituent NULL → show average of known + “incomplete” |
| PE | Basket-weighted average of scheme `pe` | Same as expense |
| Sharpe / vol | From daily NAV returns of the backtest series (client) | No NAV series → card omitted |

**Forbidden:** substituting `0` for NULL. **Forbidden:** scraping unofficial fund pages to fill PE/expense.

## 9. External APIs — usage limits

**TigZig** (`/mf/v1`): 300 req/min/IP, max 20 in-flight, 50 schemes per `/nav` call. Honor `X-RateLimit-*` and `Retry-After`. CORS `*`. One-person operator — treat as best-effort.

**MFAPI**: no published quota; homepage claims no limit, docs ask for caching. CORS `*`. Use only as search/NAV fallback. Do not pull the full `/mf` list in the client.

**AMFI Excel**: monthly, AMC-specific layouts. Parser must validate and skip bad files, not crash the run.

Cache NAV in IndexedDB (TTL: until next calendar day 21:00 IST, or until the requested range is not covered). Cache TigZig scheme master on the server (refresh during ingest).

## 10. Errors and empty states

| Event | UI | System |
|---|---|---|
| Search 429/timeout | “Search busy…” then “Search unavailable” | 1 retry → MFAPI → empty dropdown |
| One scheme NAV missing | Table cell “No NAV” | Other baskets still run |
| TigZig down, cache warm | “Using saved NAV (date)” | Backtest from IndexedDB |
| TigZig down, cache empty | “Can’t load NAV” | Charts empty; editor works |
| Insights API down | “Insights unavailable” | Backtest unchanged |
| Scheme not in SQLite | “No AMFI filing for {name}” | Other cards fill |
| Weights ≠ 100% | Save disabled, total red | No fetch |
| Amount < ₹100 | Inline error | No run |
| Ingest partial fail | Last good month stays live | `ingest_runs` records failures |
| Corrupt share URL | Toast + defaults | No crash |

FastAPI 4xx: `{ "error": "<slug>", "message": "<human>", "scheme": "<optional>" }`. 5xx do not include stack traces. TanStack Query: retry 1, stale-while-revalidate for insights.

## 11. Testing

**Must (CI)**

1. Vitest — backtest fixtures: lumpsum CAGR, SIP XIRR, max drawdown vs committed spreadsheet numbers.
2. Vitest — lock one weight, change another, total 100% ± 0.1.
3. Vitest — search client: debounce, abort, MFAPI fallback, never requests full `/mf` list.
4. Pytest — insights on a fixture SQLite: overlap %, sector sums, `pe: null` stays JSON `null`.
5. Pytest — ingest on a stripped sample sheet → golden JSON (row count + ISINs).

**Skip v1:** live network in CI, Playwright suite, coverage threshold.

```
npm test
pytest
```

All money numbers in tests come from committed files.

## 12. Repo layout

```
basket-lab-react/
  docs/superpowers/specs/     # this spec
  apps/web/                   # Vite + React + TS
  apps/api/                   # FastAPI + ingest
  data/basket.sqlite          # gitignored; created on first ingest
  fixtures/                   # sample Excel + golden JSON + NAV csv
```

Default baskets ship as `apps/web/src/data/defaults.json`:

- Index: scheme `118741` (UTI Nifty 50 Index — same master timeline as original)
- Flexi-cap: `122639` (Parag Parikh Flexi Cap Direct Growth)
- ETF: `140084` (Nippon India ETF Nifty 50 BeES)

## 13. Implementation order (for the later plan)

1. Scaffold Vite app + FastAPI hello + SQLite file create.
2. Fund search (TigZig) + basket editor + 100% rule.
3. NAV fetch + IndexedDB + backtest + table/charts.
4. URL share + yearly ranking.
5. Ingest one AMC fixture → SQLite.
6. Insights endpoint + panel (all cards, honest empties).
7. Full AMFI download path + ingest_runs.
8. MFAPI fallback + status banner.

Do not start step 6 until step 3’s backtest tests are green.

## 14. Risks

1. **AMC Excel schemas vary.** Mitigation: validate-and-skip; fixture-first parser; one AMC in CI.
2. **Expense/PE sparse.** Mitigation: nullable columns; “incomplete” label.
3. **TigZig is a single operator.** Mitigation: MFAPI fallback; IndexedDB; no NAV in our DB so we can switch providers.
4. **Market-cap list lag.** Mitigation: `unclassified` bucket, never guess.

## 15. Non-goals of this spec

Visual redesign of Basket Lab. v1 may use a clean but familiar zinc/Inter layout. Polish is a later pass.
