from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.db import init_db
from app.filing_status import filing_statuses
from app.ingest.ensure import ensure_filings, scheme_codes_from_body
from app.ingest.run import resolve_ingest_files, run_ingest
from app.ingest.scheme_master import SchemeMaster
from app.insights import compute_insights

# apps/api/app/main.py → repo root / data / basket.sqlite
DB_PATH = Path(__file__).resolve().parents[3] / "data" / "basket.sqlite"


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = init_db(DB_PATH)
    holdings_n = conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0]
    if holdings_n == 0:
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        files, notes = resolve_ingest_files(month=month, source="fixture")
        run_ingest(
            conn,
            month=month,
            files=files,
            notes=notes or "auto-seed-fixture",
        )
    app.state.db = conn
    try:
        yield
    finally:
        conn.close()


app = FastAPI(lifespan=lifespan)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/insights")
async def post_insights(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("baskets"), list):
        return JSONResponse(
            status_code=422,
            content={"error": "bad_request", "message": "baskets required"},
        )
    codes = scheme_codes_from_body(body)
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    statuses = filing_statuses(request.app.state.db, codes, month)
    return compute_insights(request.app.state.db, body, filings_by_code=statuses)


@app.post("/api/ingest")
async def post_ingest(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    month = body.get("month") or datetime.now(timezone.utc).strftime("%Y-%m")
    if not isinstance(month, str):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
    source = body.get("source")
    source_s = source if isinstance(source, str) else None
    files, notes = resolve_ingest_files(month=month, source=source_s)
    master = None
    need_join = source_s == "amfi" or any(
        Path(f).suffix.lower() in {".xlsx", ".xlsm"} for f in files
    )
    if need_join:
        try:
            master = SchemeMaster.load_cached(DB_PATH.parent)
        except Exception:
            master = None
    return run_ingest(
        request.app.state.db,
        month=month,
        files=files,
        notes=notes,
        master=master,
    )


@app.post("/api/ingest/ensure")
async def post_ingest_ensure(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    codes = body.get("schemeCodes") or scheme_codes_from_body(body)
    if not isinstance(codes, list):
        return JSONResponse(
            status_code=422,
            content={"error": "bad_request", "message": "schemeCodes required"},
        )
    codes_s = [str(c) for c in codes]
    try:
        master = SchemeMaster.load_cached(DB_PATH.parent)
    except Exception:
        master = SchemeMaster.from_rows([])
    return ensure_filings(
        request.app.state.db,
        codes_s,
        incoming=DB_PATH.parent / "incoming",
        master=master,
    )
