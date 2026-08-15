# Basket Lab React Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local React + TypeScript Basket Lab clone with TigZig search/NAV, AMFI-filing insights via FastAPI + SQLite, and no invented numbers.

**Architecture:** Vite SPA owns baskets, search, NAV cache, and backtest math. FastAPI on `127.0.0.1` owns monthly AMFI Excel ingest and insight rollups in a SQLite file. The browser never downloads the full scheme list and never stores NAV in SQLite.

**Tech Stack:** Vite 6, React 19, TypeScript 5.6, TanStack Query 5, Chart.js 4, idb-keyval 6, pako 2, Vitest 3, FastAPI, pytest, openpyxl, httpx, SQLite.

## Global Constraints

- UI is Vite + React + TypeScript; API is FastAPI bound to `127.0.0.1`.
- SQLite file is `data/basket.sqlite`. No Postgres. No NAV table.
- Search + NAV: TigZig `https://api.tigzig.com/mf/v1` first; MFAPI fallback. Never `GET https://api.mfapi.in/mf` (full list) from the client.
- No Fuse.js or any client fuzzy index over the universe.
- Insights missing fields render “not in filing” / “N/A”, never `0`.
- Baskets live in `localStorage` + share query `s=` (pako + base64). No accounts.
- FastAPI 4xx shape: `{ "error": "<slug>", "message": "<human>", "scheme": "<optional>" }`.
- Tests use committed fixtures only. CI: `npm test` and `pytest`. No live network in CI.
- Default schemes: `118741` (index), `122639` (flexi-cap), `140084` (ETF).
- Do not start insights UI (Task 11) until backtest tests from Task 2 are green.

---

## File map

```
apps/web/
  package.json
  vite.config.ts
  tsconfig.json
  tsconfig.app.json
  index.html
  src/main.tsx
  src/App.tsx
  src/index.css
  src/data/defaults.json
  src/types.ts
  src/lib/backtest/xirr.ts
  src/lib/backtest/performance.ts
  src/lib/backtest/performance.test.ts
  src/lib/weights.ts
  src/lib/weights.test.ts
  src/lib/api/search.ts
  src/lib/api/search.test.ts
  src/lib/api/nav.ts
  src/lib/api/insights.ts
  src/lib/navCache.ts
  src/lib/shareUrl.ts
  src/lib/shareUrl.test.ts
  src/lib/ranking.ts
  src/lib/ranking.test.ts
  src/lib/sharpe.ts
  src/state/LabContext.tsx
  src/components/AppHeader.tsx
  src/components/InvestmentSettings.tsx
  src/components/BasketList.tsx
  src/components/BasketEditor.tsx
  src/components/FundSearch.tsx
  src/components/BacktestView.tsx
  src/components/InsightsPanel.tsx
  src/components/ShareBar.tsx
  src/test/setup.ts
  src/test/navFixture.ts

apps/api/
  pyproject.toml
  app/__init__.py
  app/main.py
  app/db.py
  app/insights.py
  app/ingest/__init__.py
  app/ingest/parse.py
  app/ingest/run.py
  tests/test_insights.py
  tests/test_parse.py
  tests/conftest.py

fixtures/holdings/sample.csv
fixtures/holdings/golden.json
fixtures/nav/three_days.csv
data/.gitkeep
```

---

### Task 1: Scaffold web + API

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/tsconfig.app.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/src/types.ts`, `apps/web/src/data/defaults.json`, `apps/web/src/test/setup.ts`, `apps/web/vitest.config.ts`
- Create: `apps/api/pyproject.toml`, `apps/api/app/__init__.py`, `apps/api/app/main.py`, `apps/api/app/db.py`, `data/.gitkeep`
- Modify: `.gitignore` (already has venv/node_modules)

**Interfaces:**
- Consumes: nothing
- Produces: `Basket`, `FundLine`, `LabSettings` in `apps/web/src/types.ts`; `GET /api/health` → `{ "ok": true }`; `init_db(path) -> sqlite3.Connection` creating the four spec tables

- [ ] **Step 1: Write the failing API health test**

Create `apps/api/tests/test_health.py`:

```python
from fastapi.testclient import TestClient
from app.main import app

def test_health_ok():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_health.py::test_health_ok -v`

Expected: FAIL (`No module named app` or `cannot import app`)

- [ ] **Step 3: Write minimal scaffold**

`apps/api/pyproject.toml`:

```toml
[project]
name = "basket-lab-api"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "httpx>=0.27",
  "openpyxl>=3.1",
]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.24"]

[tool.pytest.ini_options]
pythonpath = ["."]
```

`apps/api/app/main.py`:

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/api/health")
def health():
    return {"ok": True}
```

`apps/api/app/db.py`:

```python
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS schemes (
  scheme_code TEXT PRIMARY KEY,
  scheme_name TEXT NOT NULL,
  isin TEXT,
  amc TEXT,
  category TEXT,
  is_etf INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS holdings (
  as_of TEXT NOT NULL,
  scheme_code TEXT NOT NULL,
  isin TEXT,
  instrument_name TEXT NOT NULL,
  asset_class TEXT,
  sector TEXT,
  rating TEXT,
  market_cap_bucket TEXT,
  weight_pct REAL NOT NULL,
  PRIMARY KEY (as_of, scheme_code, isin, instrument_name)
);
CREATE TABLE IF NOT EXISTS fundamentals (
  as_of TEXT NOT NULL,
  scheme_code TEXT NOT NULL,
  expense_ratio REAL,
  pe REAL,
  PRIMARY KEY (as_of, scheme_code)
);
CREATE TABLE IF NOT EXISTS ingest_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  month TEXT NOT NULL,
  files_ok INTEGER NOT NULL,
  files_failed INTEGER NOT NULL,
  notes TEXT
);
"""

def init_db(path: str | Path) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn
```

`apps/web/package.json` — dependencies: `react`, `react-dom`, `@tanstack/react-query`, `chart.js`, `react-chartjs-2`, `idb-keyval`, `pako`. Dev: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`.

`apps/web/vite.config.ts` proxy `/api` → `http://127.0.0.1:8000`.

`apps/web/src/types.ts`:

```ts
export type SchemeCode = string;

export type FundLine = {
  schemeCode: SchemeCode;
  schemeName: string;
  isin: string | null;
  weight: number;
  locked: boolean;
};

export type Basket = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  funds: FundLine[];
};

export type Period =
  | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "10Y" | "Custom";

export type LabSettings = {
  mode: "lumpsum" | "sip";
  amount: number;
  period: Period;
  customStart: string | null;
  customEnd: string | null;
};

export type NavPoint = { date: string; nav: number };

export type TimePoint = { x: string; y: number; drawdown: number };

export type BasketStats = {
  initial: number;
  final: number;
  abs: number;
  cagr: number;
  mdd: number;
};

export type BacktestResult = {
  basketId: string;
  series: TimePoint[];
  stats: BasketStats;
  error?: "no-nav";
};

export type SearchHit = {
  schemeCode: SchemeCode;
  schemeName: string;
  isin: string | null;
};
```

`apps/web/src/data/defaults.json`:

```json
{
  "settings": {
    "mode": "lumpsum",
    "amount": 100000,
    "period": "3Y",
    "customStart": null,
    "customEnd": null
  },
  "baskets": [
    {
      "id": "1",
      "name": "Nifty 50 Index",
      "color": "#18181b",
      "active": true,
      "funds": [
        { "schemeCode": "118741", "schemeName": "UTI Nifty 50 Index Fund", "isin": null, "weight": 100, "locked": false }
      ]
    },
    {
      "id": "2",
      "name": "Flexi Cap",
      "color": "#2563eb",
      "active": true,
      "funds": [
        { "schemeCode": "122639", "schemeName": "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", "isin": "INF879O01027", "weight": 100, "locked": false }
      ]
    },
    {
      "id": "3",
      "name": "Nifty 50 ETF",
      "color": "#16a34a",
      "active": true,
      "funds": [
        { "schemeCode": "140084", "schemeName": "Nippon India ETF Nifty 50 BeES", "isin": "INF204KB14I2", "weight": 100, "locked": false }
      ]
    }
  ]
}
```

`App.tsx` renders `<h1>Basket Lab</h1>` only.

- [ ] **Step 4: Run tests and verify they pass**

```
cd apps/api && python -m pip install -e ".[dev]" && python -m pytest tests/test_health.py -v
cd apps/web && npm install && npx tsc --noEmit
```

Expected: pytest PASS; `tsc` exits 0.

Also add `apps/api/tests/test_db.py`:

```python
from app.db import init_db

def test_init_db_creates_tables(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert names >= {"schemes", "holdings", "fundamentals", "ingest_runs"}
```

Run: `python -m pytest tests/test_db.py -v` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps data/.gitkeep
git commit -m "chore: scaffold Vite app and FastAPI health + SQLite schema"
```

---

### Task 2: Backtest engine

**Files:**
- Create: `apps/web/src/lib/backtest/xirr.ts`, `apps/web/src/lib/backtest/performance.ts`, `apps/web/src/lib/backtest/performance.test.ts`, `apps/web/src/test/navFixture.ts`

**Interfaces:**
- Consumes: `Basket`, `NavPoint`, `BacktestResult`, `LabSettings` from `src/types.ts`
- Produces:
  - `calculateXirr(txns: { date: Date; amount: number }[]): number` — percent
  - `backtestBasket(basket: Basket, navs: Record<string, NavPoint[]>, settings: LabSettings): BacktestResult`
  - `cagr(initial: number, final: number, years: number): number`

- [ ] **Step 1: Write the failing test**

`apps/web/src/test/navFixture.ts`:

```ts
import type { NavPoint } from "../types";

/** Two funds, three month-ends, easy mental math. */
export const NAV_A: NavPoint[] = [
  { date: "2023-01-01", nav: 10 },
  { date: "2023-02-01", nav: 11 },
  { date: "2024-01-01", nav: 12 },
];

export const NAV_B: NavPoint[] = [
  { date: "2023-01-01", nav: 20 },
  { date: "2023-02-01", nav: 20 },
  { date: "2024-01-01", nav: 22 },
];
```

`apps/web/src/lib/backtest/performance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { backtestBasket, cagr } from "./performance";
import { calculateXirr } from "./xirr";
import { NAV_A, NAV_B } from "../../test/navFixture";
import type { Basket, LabSettings } from "../../types";

const settings: LabSettings = {
  mode: "lumpsum",
  amount: 1000,
  period: "Custom",
  customStart: "2023-01-01",
  customEnd: "2024-01-01",
};

const basket: Basket = {
  id: "1",
  name: "Mix",
  color: "#000",
  active: true,
  funds: [
    { schemeCode: "A", schemeName: "A", isin: null, weight: 50, locked: false },
    { schemeCode: "B", schemeName: "B", isin: null, weight: 50, locked: false },
  ],
};

describe("cagr", () => {
  it("doubles in one year = 100%", () => {
    expect(cagr(100, 200, 1)).toBeCloseTo(100, 5);
  });
});

describe("backtestBasket lumpsum", () => {
  it("50/50 A+B: 1000 -> 1150, abs 15%", () => {
    const r = backtestBasket(basket, { A: NAV_A, B: NAV_B }, settings);
    expect(r.error).toBeUndefined();
    expect(r.stats.initial).toBe(1000);
    expect(r.stats.final).toBeCloseTo(1150, 6);
    expect(r.stats.abs).toBeCloseTo(15, 6);
    expect(r.stats.cagr).toBeCloseTo(cagr(1000, 1150, 1), 5);
    expect(r.series.at(-1)?.y).toBeCloseTo(1150, 6);
  });

  it("marks no-nav when a fund series is missing", () => {
    const r = backtestBasket(basket, { A: NAV_A }, settings);
    expect(r.error).toBe("no-nav");
  });
});

describe("calculateXirr", () => {
  it("one year -1000 then +1100 is ~10%", () => {
    const rate = calculateXirr([
      { date: new Date("2023-01-01"), amount: -1000 },
      { date: new Date("2024-01-01"), amount: 1100 },
    ]);
    expect(rate).toBeCloseTo(10, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/backtest/performance.test.ts`

Expected: FAIL — cannot find module `./performance`

- [ ] **Step 3: Write minimal implementation**

`xirr.ts` — Newton–Raphson, 100 iter, tol `1e-9`, years via `365.25`, clamp rate to `(-0.99, 10)`, return percent.

`performance.ts`:

```ts
import type { BacktestResult, Basket, LabSettings, NavPoint, TimePoint } from "../../types";
import { calculateXirr } from "./xirr";

export function cagr(initial: number, final: number, years: number): number {
  if (initial <= 0 || years <= 0) return 0;
  return (Math.pow(final / initial, 1 / years) - 1) * 100;
}

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function navOnOrBefore(history: NavPoint[], day: Date): number | null {
  let hit: NavPoint | null = null;
  for (const p of history) {
    if (parseDay(p.date) <= day) hit = p;
    else break;
  }
  return hit ? hit.nav : null;
}

export function backtestBasket(
  basket: Basket,
  navs: Record<string, NavPoint[]>,
  settings: LabSettings,
): BacktestResult {
  const start = parseDay(settings.customStart ?? settings.period);
  // Caller must resolve named periods to customStart/customEnd before calling,
  // OR pass already-resolved ISO dates on settings.customStart/customEnd.
  const startDate = parseDay(settings.customStart!);
  const endDate = parseDay(settings.customEnd!);

  for (const f of basket.funds) {
    if (f.weight <= 0) continue;
    if (!navs[f.schemeCode]?.length) {
      return { basketId: basket.id, series: [], stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 }, error: "no-nav" };
    }
  }

  const timeline = Object.values(navs)[0]
    .map((p) => p.date)
    .filter((d) => parseDay(d) >= startDate && parseDay(d) <= endDate);

  if (settings.mode === "lumpsum") {
    const holdings: Record<string, number> = {};
    for (const f of basket.funds) {
      if (f.weight <= 0) continue;
      const px = navOnOrBefore(navs[f.schemeCode], startDate);
      if (px == null || px === 0) {
        return { basketId: basket.id, series: [], stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 }, error: "no-nav" };
      }
      holdings[f.schemeCode] = (settings.amount * f.weight) / 100 / px;
    }
    const series: TimePoint[] = [];
    let peak = 0;
    let mdd = 0;
    for (const iso of timeline) {
      const day = parseDay(iso);
      let value = 0;
      for (const f of basket.funds) {
        if (f.weight <= 0) continue;
        const px = navOnOrBefore(navs[f.schemeCode], day);
        if (px == null) {
          value = NaN;
          break;
        }
        value += holdings[f.schemeCode] * px;
      }
      if (!Number.isFinite(value)) continue;
      if (value > peak) peak = value;
      const dd = peak > 0 ? ((value - peak) / peak) * 100 : 0;
      if (dd < mdd) mdd = dd;
      series.push({ x: iso, y: value, drawdown: dd });
    }
    const final = series.at(-1)?.y ?? 0;
    const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 86400000);
    return {
      basketId: basket.id,
      series,
      stats: {
        initial: settings.amount,
        final,
        abs: ((final - settings.amount) / settings.amount) * 100,
        cagr: cagr(settings.amount, final, years),
        mdd,
      },
    };
  }

  // SIP: invest settings.amount on first date and every month anniversary
  const holdings: Record<string, { units: number; weight: number }> = {};
  for (const f of basket.funds) {
    if (f.weight <= 0) continue;
    holdings[f.schemeCode] = { units: 0, weight: f.weight };
  }
  const series: TimePoint[] = [];
  let totalInvested = 0;
  let peak = 0;
  let mdd = 0;
  let nextSip = new Date(startDate);
  let sipCount = 0;
  const cashflows: { date: Date; amount: number }[] = [];

  for (const iso of timeline) {
    const day = parseDay(iso);
    if (day >= nextSip) {
      for (const f of basket.funds) {
        if (f.weight <= 0) continue;
        const px = navOnOrBefore(navs[f.schemeCode], day);
        if (px == null || px === 0) continue;
        holdings[f.schemeCode].units += (settings.amount * f.weight) / 100 / px;
      }
      cashflows.push({ date: new Date(day), amount: -settings.amount });
      totalInvested += settings.amount;
      sipCount += 1;
      nextSip = new Date(startDate);
      nextSip.setMonth(nextSip.getMonth() + sipCount);
    }
    let value = 0;
    for (const f of basket.funds) {
      if (f.weight <= 0) continue;
      const px = navOnOrBefore(navs[f.schemeCode], day);
      if (px == null) {
        value = NaN;
        break;
      }
      value += holdings[f.schemeCode].units * px;
    }
    if (!Number.isFinite(value) || totalInvested === 0) continue;
    if (value > peak) peak = value;
    const dd = peak > 0 ? ((value - peak) / peak) * 100 : 0;
    if (dd < mdd) mdd = dd;
    series.push({ x: iso, y: value, drawdown: dd });
  }
  const final = series.at(-1)?.y ?? 0;
  if (series.length) {
    cashflows.push({ date: parseDay(series.at(-1)!.x), amount: final });
  }
  return {
    basketId: basket.id,
    series,
    stats: {
      initial: totalInvested,
      final,
      abs: totalInvested > 0 ? ((final - totalInvested) / totalInvested) * 100 : 0,
      cagr: calculateXirr(cashflows),
      mdd,
    },
  };
}
```

Also export `resolveRange(period, customStart, customEnd, today = new Date()): { start: string; end: string }` in the same file: named periods subtract months/years from `today`; `Custom` uses the two ISO strings. Callers must set `settings.customStart/End` via this helper before `backtestBasket`. Remove the unused `start` variable in the implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/backtest/performance.test.ts`

Expected: PASS (3 tests). If SIP is untested here, that is OK — lumpsum + XIRR are the gate.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/backtest apps/web/src/test/navFixture.ts
git commit -m "feat: add lumpsum/SIP backtest and XIRR"
```

---

### Task 3: Weight auto-balance

**Files:**
- Create: `apps/web/src/lib/weights.ts`, `apps/web/src/lib/weights.test.ts`

**Interfaces:**
- Consumes: `FundLine`
- Produces: `applyWeightChange(funds: FundLine[], id: string, next: number): FundLine[]` — unlocked others absorb overflow so sum stays 100; locked weights do not change; result weights ≥ 0

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyWeightChange } from "./weights";
import type { FundLine } from "../types";

const funds: FundLine[] = [
  { schemeCode: "A", schemeName: "A", isin: null, weight: 50, locked: false },
  { schemeCode: "B", schemeName: "B", isin: null, weight: 50, locked: false },
  { schemeCode: "C", schemeName: "C", isin: null, weight: 0, locked: true },
];

describe("applyWeightChange", () => {
  it("raising A to 70 pulls B to 30", () => {
    const next = applyWeightChange(funds, "A", 70);
    expect(next.find((f) => f.schemeCode === "A")!.weight).toBeCloseTo(70, 2);
    expect(next.find((f) => f.schemeCode === "B")!.weight).toBeCloseTo(30, 2);
    expect(next.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(100, 1);
  });

  it("does not change a locked fund", () => {
    const locked: FundLine[] = [
      { schemeCode: "A", schemeName: "A", isin: null, weight: 40, locked: true },
      { schemeCode: "B", schemeName: "B", isin: null, weight: 60, locked: false },
    ];
    const next = applyWeightChange(locked, "B", 70);
    expect(next.find((f) => f.schemeCode === "A")!.weight).toBe(40);
    expect(next.find((f) => f.schemeCode === "B")!.weight).toBeCloseTo(60, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/weights.test.ts`

Expected: FAIL — cannot find `./weights`

- [ ] **Step 3: Write minimal implementation**

Port the original basket-lab `handleWeightChange` logic: clamp `next` to `[0, 100 - otherLocked]`; set the target; if overflow vs 100, scale unlocked others by proportion. Round to 2 decimals.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/weights.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/weights.ts apps/web/src/lib/weights.test.ts
git commit -m "feat: auto-balance basket weights with locks"
```

---

### Task 4: Search client (no full list)

**Files:**
- Create: `apps/web/src/lib/api/search.ts`, `apps/web/src/lib/api/search.test.ts`

**Interfaces:**
- Consumes: `SearchHit`
- Produces: `searchFunds(query: string, fetchFn?: typeof fetch, signal?: AbortSignal): Promise<SearchHit[]>`
  - TigZig `GET https://api.tigzig.com/mf/v1/search?q={query}&limit=20`
  - Map `results[].scheme_code` / `scheme_name` / `isin`
  - On non-OK or throw: `GET https://api.mfapi.in/mf/search?q={query}` mapping `schemeCode` / `schemeName`
  - Must never request `https://api.mfapi.in/mf` without `/search`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { searchFunds } from "./search";

describe("searchFunds", () => {
  it("maps TigZig hits and does not call the full MFAPI list", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(String(url)).not.toMatch(/api\.mfapi\.in\/mf$/);
      return {
        ok: true,
        json: async () => ({
          results: [
            { scheme_code: 140084, scheme_name: "Nippon India ETF Nifty 50 BeES", isin: "INF204KB14I2" },
          ],
        }),
      } as Response;
    });
    const hits = await searchFunds("bees", fetchFn as unknown as typeof fetch);
    expect(hits[0]).toEqual({
      schemeCode: "140084",
      schemeName: "Nippon India ETF Nifty 50 BeES",
      isin: "INF204KB14I2",
    });
    expect(String(fetchFn.mock.calls[0][0])).toContain("api.tigzig.com/mf/v1/search");
    expect(String(fetchFn.mock.calls[0][0])).toContain("limit=20");
  });

  it("falls back to MFAPI search when TigZig fails", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("tigzig")) throw new Error("down");
      expect(u).toContain("api.mfapi.in/mf/search");
      return {
        ok: true,
        json: async () => [{ schemeCode: 122639, schemeName: "PPFAS" }],
      } as Response;
    });
    const hits = await searchFunds("ppfas", fetchFn as unknown as typeof fetch);
    expect(hits[0].schemeCode).toBe("122639");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/api/search.test.ts`

Expected: FAIL — cannot find `./search`

- [ ] **Step 3: Write `search.ts`**

Implement as specified. Coerce `scheme_code` to string. If TigZig returns `{ results: [] }` that is success (no fallback). Fallback only on network error or `!ok`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/api/search.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/search.ts apps/web/src/lib/api/search.test.ts
git commit -m "feat: TigZig fund search with MFAPI fallback"
```

---

### Task 5: Lab context + editor + search UI

**Files:**
- Create: `apps/web/src/state/LabContext.tsx`, `apps/web/src/components/FundSearch.tsx`, `apps/web/src/components/BasketEditor.tsx`, `apps/web/src/components/BasketList.tsx`, `apps/web/src/components/InvestmentSettings.tsx`, `apps/web/src/components/AppHeader.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/main.tsx` (wrap `QueryClientProvider` + `LabProvider`)

**Interfaces:**
- Consumes: `applyWeightChange`, `searchFunds`, `defaults.json`, types
- Produces: `useLab()` → `{ settings, setSettings, baskets, setBaskets, editingId, openEditor, closeEditor, saveBasket }`
  - `saveBasket` rejects (returns `false`) unless weights sum to 100 ± 0.1
  - `FundSearch` calls `searchFunds` after 200ms debounce; new keystroke `abort()`s the previous `AbortController`

- [ ] **Step 1: Write the failing test**

`apps/web/src/state/LabContext.test.tsx` — render a tiny consumer that calls `saveBasket` with weights summing to 90, expect `false`; with 100, expect `true` and the basket in state.

Use `@testing-library/react` `render` + `act`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/state/LabContext.test.tsx`

Expected: FAIL — module not found

- [ ] **Step 3: Implement context + components**

`LabProvider` initializes from `defaults.json`. Persist `baskets` + `settings` to `localStorage` key `basket-lab-v1` on change.

`FundSearch`: input `onChange` sets local query; `useEffect` debounce 200ms; if `query.trim().length < 2` hide list; else `searchFunds(query, fetch, controller.signal)`.

`BasketEditor`: modal; name; color swatches `#18181b #2563eb #16a34a #dc2626 #d97706 #7c3aed`; table of funds with weight inputs calling `applyWeightChange`; lock toggle; delete row; total display green iff `Math.abs(sum - 100) < 0.1` else red; Save disabled when red.

`BasketList`: checkbox `active`, edit/duplicate/delete (cannot delete last basket), “Create New Basket”, “Reset Defaults”.

`InvestmentSettings`: lumpsum/SIP toggle, amount number min 100, period buttons including Custom with two date inputs.

Wire them in `App.tsx` in the spec layout order (header, settings | list). Charts/insights are placeholders `<section />` until later tasks.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/state/LabContext.test.tsx src/lib/weights.test.ts`

Expected: PASS. Manual: `npm run dev` — type “parag”, see results, add fund, set 100%, save.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat: basket editor, search UI, and lab state"
```

---

### Task 6: NAV fetch + IndexedDB

**Files:**
- Create: `apps/web/src/lib/api/nav.ts`, `apps/web/src/lib/api/nav.test.ts`, `apps/web/src/lib/navCache.ts`

**Interfaces:**
- Consumes: `NavPoint`, `SchemeCode`
- Produces:
  - `fetchNav(codes: string[], since: string, to: string, fetchFn?: typeof fetch): Promise<Record<string, NavPoint[]>>`
    - TigZig `GET https://api.tigzig.com/mf/v1/nav?schemes={codes.join(",")}&since={since}&to={to}` in chunks of 50
    - Map each scheme’s `data[]` `{ date, nav }` to `NavPoint` (`date` already ISO from TigZig)
    - On failure of a chunk: per-code MFAPI `GET https://api.mfapi.in/mf/{code}` and parse `DD-MM-YYYY`
  - `readNavCache(code: string): Promise<NavPoint[] | null>`
  - `writeNavCache(code: string, points: NavPoint[]): Promise<void>`
  - Cache key `nav:{code}`; treat cache as fresh if it covers `[since, to]` and was written before next 21:00 IST after `lastPoint.date`

- [ ] **Step 1: Write the failing test**

Mock `fetchFn` returning TigZig bulk shape:

```json
{
  "schemes": {
    "118741": {
      "data": [{ "date": "2023-01-02", "nav": 100.1 }]
    }
  }
}
```

Assert `fetchNav(["118741"], "2023-01-01", "2023-01-31", fetchFn)["118741"][0].nav === 100.1` and URL contains `schemes=118741`.

Second test: TigZig throws → MFAPI body `{ data: [{ date: "02-01-2023", nav: "100.10000" }] }` → same point.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/api/nav.test.ts`

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement `nav.ts` + `navCache.ts`**

`idb-keyval` `get`/`set`. IndexedDB store name default is fine.

If TigZig single-scheme response has top-level `data` (not wrapped in `schemes`), handle that too.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/api/nav.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/nav.ts apps/web/src/lib/api/nav.test.ts apps/web/src/lib/navCache.ts
git commit -m "feat: fetch NAV from TigZig in batches with IndexedDB cache"
```

---

### Task 7: Backtest view (table + charts)

**Files:**
- Create: `apps/web/src/components/BacktestView.tsx`, `apps/web/src/lib/resolveSettings.ts`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/state/LabContext.tsx` (expose `results: BacktestResult[]` + `runAnalysis`)

**Interfaces:**
- Consumes: `backtestBasket`, `resolveRange`, `fetchNav`, `readNavCache`, `writeNavCache`
- Produces: `runAnalysis(): Promise<void>` — for each **active** basket, ensure NAV, call `backtestBasket` with settings that have `customStart`/`customEnd` filled by `resolveRange(settings.period, settings.customStart, settings.customEnd)`
- Table columns: name, invested, current, abs, CAGR/XIRR, max drawdown
- `error === "no-nav"` → cell “No NAV”
- Charts: Chart.js line, portfolio value and drawdown, one dataset per basket, color = `basket.color`

- [ ] **Step 1: Write the failing test**

`resolveRange("1Y", null, null, new Date("2024-01-15"))` → `{ start: "2023-01-15", end: "2024-01-15" }`.  
`resolveRange("3M", null, null, new Date("2024-01-15"))` → start `2023-10-15`.  
`resolveRange("Custom", "2020-01-01", "2021-01-01", …)` → those dates.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/resolveSettings.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement resolveRange + BacktestView + runAnalysis**

Trigger `runAnalysis` on mount and when `settings` / active baskets / allocations change (debounce 300ms). Skip run when any **active** basket sum is not 100 ± 0.1.

Amount `< 100`: show `#amount-error` “Minimum amount should be ₹100”, do not run.

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run src/lib/backtest/performance.test.ts src/lib/resolveSettings.test.ts`

Expected: PASS. Manual: change period, table numbers update.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat: performance table and growth/drawdown charts"
```

---

### Task 8: Share URL

**Files:**
- Create: `apps/web/src/lib/shareUrl.ts`, `apps/web/src/lib/shareUrl.test.ts`, `apps/web/src/components/ShareBar.tsx`
- Modify: `LabContext.tsx` (hydrate from `?s=` on boot; write `s=` after analysis via `history.replaceState`)

**Interfaces:**
- Consumes: `Basket`, `LabSettings`
- Produces:
  - `encodeShare(payload: { settings: LabSettings; baskets: Basket[] }): string`
  - `decodeShare(s: string): { settings: LabSettings; baskets: Basket[] } | null`
  - Algorithm: `JSON.stringify` → `pako.deflate` → base64url (replace `+/=` with `-_`, strip `=`)

- [ ] **Step 1: Write the failing test**

Round-trip `defaults.json` through `encodeShare` / `decodeShare`.  
`decodeShare("%%%") === null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/shareUrl.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement encode/decode + ShareBar**

ShareBar: readonly input of `window.location.href`, Copy button, toast “Share link copied”. Corrupt `s=` → toast “Could not load shared link” and load defaults.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/shareUrl.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/shareUrl.ts apps/web/src/lib/shareUrl.test.ts apps/web/src/components/ShareBar.tsx apps/web/src/state/LabContext.tsx
git commit -m "feat: pako share URLs for baskets and settings"
```

---

### Task 9: Yearly ranking

**Files:**
- Create: `apps/web/src/lib/ranking.ts`, `apps/web/src/lib/ranking.test.ts`
- Modify: `BacktestView.tsx` (ranking table under charts)

**Interfaces:**
- Consumes: `BacktestResult[]`
- Produces: `yearlyRanking(results: BacktestResult[]): { year: number; order: { basketId: string; ret: number }[] }[]`
  - For each calendar year in the union of series, compute that year’s return as `(lastY / firstY - 1) * 100` using first and last point in that year
  - Sort descending by `ret`

- [ ] **Step 1: Write the failing test**

Two series, 2023: A 100→110 (+10%), B 100→105 (+5%) → order A then B.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/ranking.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement ranking + table**

Render years as columns, baskets as rows, or the original “best to worst per year” list. Include the italic note: “Make sure all funds have data for the selected timeframe for accurate results”.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/ranking.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/ranking.ts apps/web/src/lib/ranking.test.ts apps/web/src/components/BacktestView.tsx
git commit -m "feat: yearly performance ranking"
```

---

### Task 10: Ingest parser + fixture SQLite

**Files:**
- Create: `fixtures/holdings/sample.csv`, `fixtures/holdings/golden.json`, `apps/api/app/ingest/parse.py`, `apps/api/tests/test_parse.py`

**Interfaces:**
- Consumes: `init_db`
- Produces: `parse_holdings_csv(text: str) -> list[dict]` and `load_holdings(conn, rows) -> int`
  - Required CSV headers: `as_of,scheme_code,isin,instrument_name,asset_class,sector,rating,market_cap_bucket,weight_pct`
  - Empty `rating` / `pe` / `expense` stay Python `None`
  - Reject file if any `weight_pct` is non-numeric or missing `scheme_code`

- [ ] **Step 1: Write the failing test + fixture**

`fixtures/holdings/sample.csv`:

```csv
as_of,scheme_code,isin,instrument_name,asset_class,sector,rating,market_cap_bucket,weight_pct
2026-07-31,122639,INE002A01018,Reliance Industries,equity,Energy,,large,8.5
2026-07-31,122639,INE040A01034,HDFC Bank,equity,Financial,,large,7.2
2026-07-31,122639,,TREPS,cash,,,unclassified,4.0
2026-07-31,140084,INE002A01018,Reliance Industries,equity,Energy,,large,10.1
```

`apps/api/tests/test_parse.py` asserts 4 rows, Reliance weight 8.5, TREPS `isin is None`, `rating is None`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_parse.py -v`

Expected: FAIL — cannot import `parse_holdings_csv`

- [ ] **Step 3: Implement parser**

Use `csv.DictReader`. Strip cells. `isin` `""` → `None`. `weight_pct = float(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_parse.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fixtures apps/api/app/ingest apps/api/tests/test_parse.py
git commit -m "feat: parse AMFI-normalized holdings CSV into rows"
```

---

### Task 11: Insights API

**Files:**
- Create: `apps/api/app/insights.py`, `apps/api/tests/test_insights.py`
- Modify: `apps/api/app/main.py` (add `POST /api/insights`), `apps/api/app/db.py` if a `get_db` dependency is needed

**Interfaces:**
- Consumes: request body

```json
{
  "baskets": [
    {
      "id": "1",
      "name": "Core",
      "funds": [{ "schemeCode": "122639", "weight": 100 }]
    }
  ]
}
```

- Produces: JSON

```json
{
  "asOf": "2026-07-31",
  "baskets": [
    {
      "id": "1",
      "missingSchemes": [],
      "holdings": [{ "isin": "INE002A01018", "name": "Reliance Industries", "weight": 8.5 }],
      "sector": { "Energy": 8.5, "Financial": 7.2, "Unclassified": 4.0 },
      "asset": { "equity": 15.7, "cash": 4.0 },
      "credit": null,
      "creditNote": "N/A — no debt holdings",
      "equitySplit": { "large": 15.7, "mid": 0, "small": 0, "unclassified": 0 },
      "expenseRatio": null,
      "expenseIncomplete": true,
      "pe": null,
      "peIncomplete": true
    }
  ],
  "overlap": null
}
```

Notes:
- Basket holding weight = `fund.weight/100 * holding.weight_pct`
- Top holdings: top 10 by weight, skip cash optional — include all asset classes
- `credit` is `null` (not `{}`) when there is no debt
- `pe` / `expenseRatio` are JSON `null` when any constituent `fundamentals` value is NULL; if some exist, average the known and set `*Incomplete: true`
- Two baskets both with filings → `overlap` is `{ "1|2": <sum of min weights per isin> }`
- Unknown scheme → listed in `missingSchemes`, other cards still fill from known funds
- Error 422 if `baskets` missing: `{ "error": "bad_request", "message": "baskets required" }`

- [ ] **Step 1: Write the failing test**

`conftest.py` builds a tmp SQLite via `init_db`, `load_holdings` from `sample.csv`, no fundamentals rows.

`test_insights.py`:
1. POST one basket `122639` @ 100 → Reliance weight 8.5, `credit is None`, `pe is None`.
2. POST two baskets (122639 and 140084) → `overlap["1|2"]` equals `min(8.5,10.1)=8.5` for Reliance (plus any other common ISINs).
3. Assert response JSON uses `null` not `0` for `pe`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_insights.py -v`

Expected: FAIL — 404 on `/api/insights`

- [ ] **Step 3: Implement `compute_insights(conn, body) -> dict` and the route**

`main.py` lifespan opens `data/basket.sqlite` (create empty schema if missing). Tests pass a fixture DB by monkeypatching `app.state.db`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_insights.py tests/test_parse.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: POST /api/insights rollups and overlap"
```

---

### Task 12: Insights panel + Sharpe

**Files:**
- Create: `apps/web/src/lib/api/insights.ts`, `apps/web/src/lib/sharpe.ts`, `apps/web/src/lib/sharpe.test.ts`, `apps/web/src/components/InsightsPanel.tsx`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `POST /api/insights` via Vite proxy; `BacktestResult.series`
- Produces:
  - `postInsights(baskets: Basket[]): Promise<InsightsResponse>`
  - `sharpeFromSeries(series: TimePoint[], rfAnnual = 0): number | null` — daily returns, sample stdev, `sqrt(252) * mean / stdev`; `null` if `< 3` points
- Cards: Top holdings, Sector, Asset, Credit (`creditNote` if `credit === null`), Equity split, Overlap (`overlap === null` → “Add another basket with holdings data”), Expense, PE (append “incomplete” when flags true), Sharpe (from client series)
- Missing scheme: card line “No AMFI filing for {name}”
- Query error: section “Insights unavailable”

- [ ] **Step 1: Write the failing Sharpe test**

Constant series → `sharpeFromSeries` is `null` or `0` only if stdev is 0 — **return `null` when stdev is 0** (do not emit 0 as a fake Sharpe). Rising series → finite positive number.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/sharpe.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement sharpe + InsightsPanel**

Use TanStack Query key `["insights", basketSignature]`. `retry: 1`.

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run src/lib/sharpe.test.ts`

Expected: PASS. Manual: with API running and fixture loaded (`python -c` insert sample.csv), insights cards show Reliance; PE shows “not in filing”.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat: insights panel with honest empty states"
```

---

### Task 13: Ingest runner

**Files:**
- Create: `apps/api/app/ingest/run.py`
- Modify: `apps/api/app/main.py` (`POST /api/ingest`), `apps/api/tests/test_ingest_run.py`

**Interfaces:**
- Consumes: `parse_holdings_csv`, `init_db`
- Produces: `run_ingest(conn, *, month: str, files: list[Path]) -> dict`
  - For each file: parse or count as failed; never throw past the file
  - Insert `ingest_runs` row
  - `POST /api/ingest` reads `fixtures/holdings/sample.csv` when `{"source":"fixture"}`; otherwise looks in `data/incoming/*.csv` (v1 does not scrape AMFI in CI)
  - Live AMFI download is a function `download_amfi_month(month: str, dest: Path) -> list[Path]` using httpx against `https://www.amfiindia.com/online-center/portfolio-disclosure` **only when** env `AMFI_INGEST=1`. If the HTML layout cannot be parsed, return `[]` and set `ingest_runs.notes` to `amfi-listing-unparsed`. Do not scrape Groww.

- [ ] **Step 1: Write the failing test**

Call `run_ingest` with the sample CSV → `files_ok == 1`, holdings count 4, `ingest_runs` has one row.

Call with a junk file + the sample → `files_failed == 1`, `files_ok == 1`, previous holdings still present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_ingest_run.py -v`

Expected: FAIL

- [ ] **Step 3: Implement runner + route**

Bind uvicorn host `127.0.0.1`. Document in `apps/api/README.md`:

```
uvicorn app.main:app --host 127.0.0.1 --port 8000
AMFI_INGEST=1 python -m app.ingest.run --month 2026-07
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && python -m pytest -v`

Expected: all API tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: ingest runner with per-file skip and fixture source"
```

---

### Task 14: Status banner + Excel ingest path

**Files:**
- Create: `apps/api/app/ingest/excel.py`, `apps/api/tests/test_excel.py`
- Modify: `apps/web/src/components/AppHeader.tsx`, `apps/web/src/lib/api/nav.ts` (already has fallback; surface status)

**Interfaces:**
- Consumes: openpyxl workbook
- Produces: `sheet_to_csv_rows(ws) -> list[dict] | None`
  - Detect a header row containing `ISIN` and (`%` or `weight` or `NAV`)
  - Map common AMC headers: ISIN, name, industry/sector, rating, `% to NAV`
  - Return `None` if headers not found (caller marks file failed)
- `AppHeader` status:
  - `ready` / `Using saved NAV (YYYY-MM-DD)` / `Can't load NAV` / `Search unavailable` / `Insights unavailable`
  - Never blocks the editor

- [ ] **Step 1: Write the failing test**

Build an in-memory openpyxl sheet with headers `Name, ISIN, Industry, % to NAV` and two data rows. `sheet_to_csv_rows` returns two dicts with `isin` and `weight_pct`.

Sheet with headers `Foo, Bar` → `None`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_excel.py -v`

Expected: FAIL

- [ ] **Step 3: Implement excel mapper + header status**

`LabContext` holds `status: { kind: "ready" | "cached-nav" | "no-nav" | "search-down" | "insights-down"; detail?: string }`.

- [ ] **Step 4: Run full suites**

```
cd apps/api && python -m pytest -v
cd apps/web && npm test
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps
git commit -m "feat: AMC Excel header detection and global status banner"
```

---

## Self-review (plan vs spec)

| Spec section | Task |
|---|---|
| Fast search, no full list, no Fuse | 4, 5 |
| Backtest CAGR/XIRR/drawdown, SIP/lumpsum | 2, 7 |
| Charts + table + ranking | 7, 9 |
| Share URL pako | 8 |
| Defaults 118741 / 122639 / 140084 | 1 |
| Insights POST body + overlap formula | 11, 12 |
| NULL ≠ 0, credit N/A, incomplete PE/expense | 11, 12 |
| SQLite schema, no NAV table | 1, 10 |
| Ingest skip bad files, last snapshot stays | 13, 14 |
| TigZig limits / MFAPI fallback | 4, 6, 14 |
| Errors / status banner | 14 |
| Vitest + pytest fixtures | 2–4, 8–14 |
| Insights after backtest tests | 11 after 2 |
| AMFI Excel official only | 13, 14 |
| ETF same pipes | search + scheme codes; no extra path |

No TBD / “handle edge cases” left without an exact rule. Types (`Basket`, `FundLine`, `SearchHit`, `BacktestResult`, `postInsights` body) match across tasks.
