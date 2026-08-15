# Basket Lab API

Local FastAPI service for AMFI holdings ingest and basket insights. Bind to loopback only.

```
uvicorn app.main:app --host 127.0.0.1 --port 8000
AMFI_INGEST=1 python -m app.ingest.run --month 2026-07
```

`POST /api/ingest` with `{"source":"fixture"}` loads `fixtures/holdings/sample.csv`. Otherwise the runner reads `data/incoming/*.csv`. Live AMFI download runs only when `AMFI_INGEST=1`.
