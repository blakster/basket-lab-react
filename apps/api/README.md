# Basket Lab API

Local FastAPI service for AMFI holdings ingest and basket insights. Bind to loopback only. The web app expects it on port 8000; see the [root README](../../README.md).

Needs Python 3.11 or newer (`requires-python` in `pyproject.toml`).

Do not run bare `uvicorn`. Your PATH `uvicorn` is often a different Python than the one you `pip install`ed.

```
cd apps/api
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Without a venv, use the same interpreter you installed into:

```
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Health check and tests:

```
curl http://127.0.0.1:8000/api/health   # {"ok":true}
.venv/bin/python -m pytest -q
```

First startup creates `data/basket.sqlite` at the repo root and seeds it from `fixtures/holdings/sample.csv` when the holdings table is empty. Delete the file to seed again.

## Ingest (v1)

Opening Insights calls Foliyo Markets (`get_fund_details` by AMFI code) and caches the snapshot in SQLite. Manual AMC Excel upload still works. Do not scrape Groww / Kuvera / Tickertape.

Persist path:

1. Create the drop directory first, from the repo root: `mkdir -p data/incoming`. The repo does not track it, and ingest returns `files_ok: 0` with no error when no files exist. Then drop AMC `.xlsx` / `.csv` in `data/incoming/` **or** `POST /api/ingest {"source":"amfi"}` to try AMFI’s listing.
2. Ingest reads every sheet (one scheme per sheet).
3. Missing `scheme_code` is filled from the TigZig scheme master (`/mf/v1/download?format=latest`) by **scheme name** (sheet title), never by holding ISIN.
4. Rows land in SQLite. Insights look up by AMFI scheme code.

```
POST /api/ingest  {"source":"fixture"}   # fixtures/holdings/sample.csv (2 schemes)
POST /api/ingest                         # data/incoming/*.{csv,xlsx}
POST /api/ingest  {"source":"amfi"}      # try AMFI listing + name join
.venv/bin/python -m app.ingest.run --month 2026-07 --source fixture
```

AMFI’s website is a file index, not an API. If `source=amfi` returns `amfi-listing-unparsed`, download the AMC workbook yourself (same files AMFI hosts) and drop it in the repo-root `data/incoming/`.

Opening Insights (or saving a basket) calls `POST /api/ingest/ensure`, which asks Foliyo for holdings, mixes, PE and expense. AMC website downloads are no longer on this path.

`AMFI_INGEST=1` also enables AMFI’s listing download. Do not scrape Groww / Kuvera / Tickertape.
