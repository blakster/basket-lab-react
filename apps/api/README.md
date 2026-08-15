# Basket Lab API

Local FastAPI service for AMFI holdings ingest and basket insights. Bind to loopback only.

```
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Ingest (v1)

The v1 persist path is **normalized CSV**. `scheme_code` is required on every row (see `fixtures/holdings/sample.csv`).

```
POST /api/ingest  {"source":"fixture"}   # loads fixtures/holdings/sample.csv
POST /api/ingest                         # reads data/incoming/*.csv
python -m app.ingest.run --month 2026-07 --source fixture
python -m app.ingest.run --month 2026-07
```

AMC Excel mapping (`sheet_to_csv_rows`) can detect common holdings headers, but those rows **cannot persist** without a scheme-code join. Excel files that omit `scheme_code` fail ingest.

`AMFI_INGEST=1` only attempts to download files listed on the AMFI portfolio page. It is not a working AMC holdings pipeline — downloaded spreadsheets still need scheme codes before they can be stored.
