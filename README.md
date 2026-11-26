# Basket Lab

Local web app for Indian mutual-fund and ETF baskets and portfolio tracking.
Build a basket, backtest lumpsum or SIP, compare CAGR / XIRR / max drawdown,
read fund-filing insights, and track holdings imported from a CAMS, KFintech,
NSDL, or CDSL statement PDF or entered by hand.

Product intent is in [PRODUCT.md](PRODUCT.md). Visual rules are in
[DESIGN.md](DESIGN.md).

## What runs locally

Two processes, both on loopback:

| Process | Directory | Address |
| --- | --- | --- |
| Vite + React + TypeScript | `apps/web` | `http://localhost:5173` |
| FastAPI | `apps/api` | `http://127.0.0.1:8000` |

The web dev server proxies `/api` to `127.0.0.1:8000` (see
`apps/web/vite.config.ts`). Start both processes. With only the web server
running, the Insights and Portfolio workspaces and filing upload fail on `/api`
requests.

The API binds to loopback only. Do not expose port 8000.

## Requirements

- Node.js 20 or newer with npm. Verified with Node 24.22.3 and npm 11.19.1.
- Python 3.11 or newer with venv support. Verified with Python 3.12.16. Check
  `python3 --version` before setup. If it is older than 3.11, use the newer
  interpreter executable instead of `python3` in the venv command.
- Network access for the first `npm ci` and `pip install`. At runtime, the
  browser calls TigZig and MFAPI for search and NAV. The API calls TigZig for
  scheme-master lookups and Foliyo Markets for Insights. The test suites do not
  use the network.

## Setup

Run the web process and the API process in two terminals.

### Terminal 1: web

```
cd apps/web
npm ci
npm run dev
```

Open `http://localhost:5173`.

### Terminal 2: API

```
cd apps/api
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Check the API:

```
curl http://127.0.0.1:8000/api/health
# {"ok":true}
```

Use `.venv/bin/python` for every API command. A bare `python` or `uvicorn` on
your PATH can be a different interpreter that has no API dependencies.

If port 8000 is busy, use another port and change the proxy target in
`apps/web/vite.config.ts` to match.

## Test

Web tests, from the repo root:

```
cd apps/web
npm test        # Vitest, single run; npm run test:watch for watch mode
```

API tests, from the repo root:

```
cd apps/api
.venv/bin/python -m pytest -q
```

Both suites pass on a clean checkout. `npm run build` type-checks the web app
and writes `apps/web/dist/`.

## Local data

- `data/basket.sqlite`: fund filings and portfolio data. Gitignored. The API
  creates it on first start and seeds the fixture fund filings from
  `fixtures/holdings/sample.csv` when the holdings table is empty. Deleting the
  file removes portfolio entries too; the next start seeds the fixture filings
  again.
- `data/incoming/`: drop directory for AMC `.xlsx`, `.xlsm`, or `.csv` files.
  The repo does not track this directory. Create it before you use it:
  `mkdir -p data/incoming`.
  With no files present, `POST /api/ingest` returns `files_ok: 0` and no error.
- Compare NAV series: cached in browser IndexedDB, never in SQLite. Clear the
  site data to fetch them again. Portfolio NAV history is cached only in memory.
- `data/scheme_master_latest.csv`: cached TigZig scheme master for ISIN
  lookups. Gitignored. The API reads it into memory at first use. After
  deleting it, restart the API to download it again on the next lookup.

## Where to read next

- [apps/api/README.md](apps/api/README.md): portfolio endpoints, ingest
  sources, fixture paths, and the CLI.
- [apps/web/README.md](apps/web/README.md): web scripts, proxy, and test setup.
- `docs/superpowers/specs/` and `docs/superpowers/plans/`: design specs and
  plans.

## Constraints

- One route `/`. Workspace selection uses hash fragments. Old `s=` share links
  are ignored.
- No sign-in or cloud sync. Baskets live in `localStorage`; portfolio entries
  live in `data/basket.sqlite`.
- Missing insight values stay empty. Never substitute zero.
- Do not scrape Groww, Kuvera, or Tickertape.
