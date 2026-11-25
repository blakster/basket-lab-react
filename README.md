# Basket Lab

Local web app for Indian mutual-fund and ETF baskets. Build a basket, backtest
lumpsum or SIP, compare CAGR / XIRR / max drawdown, read AMFI-filing insights,
and share the setup as a URL.

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
running, the Insights tab and filing upload fail on `/api` requests.

The API binds to loopback only. Do not expose port 8000.

## Requirements

- Node.js 20 or newer with npm. Verified with Node 24.22.2 and npm 11.19.1.
- Python 3.11 or newer with venv support. Verified with Python 3.12.3.
- Network access for the first `npm ci` and `pip install`. At runtime, search
  and NAV call TigZig and MFAPI, and Insights calls Foliyo Markets through the
  API. The test suites do not use the network.

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

- `data/basket.sqlite`: holdings database. Gitignored. The API creates it on
  first start and seeds it from `fixtures/holdings/sample.csv`. Delete the file
  to seed again.
- `data/incoming/`: drop directory for AMC `.xlsx` / `.csv` files. The repo does
  not track this directory. Create it before you use it: `mkdir -p data/incoming`.
  With no files present, `POST /api/ingest` returns `files_ok: 0` and no error.
- NAV series: cached in browser IndexedDB, never in SQLite. Clear the site data
  to fetch it again.

## Where to read next

- [apps/api/README.md](apps/api/README.md): ingest sources, fixture paths, and
  the CLI.
- [apps/web/README.md](apps/web/README.md): web scripts, proxy, and test setup.
- `docs/superpowers/specs/` and `docs/superpowers/plans/`: design specs and
  plans.

## Constraints

- One route `/`. Shared links are the same page with an `s=` query.
- No accounts, no cloud baskets. Baskets live in `localStorage`.
- Missing insight values stay empty. Never substitute zero.
- Do not scrape Groww, Kuvera, or Tickertape.
