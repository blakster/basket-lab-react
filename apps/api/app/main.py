import tempfile
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.cas_routes import router as cas_router
from app.db import connect_db, init_db
from app.filing_status import filing_statuses
from app.ingest.cas import _IMPORT_LOCK as IMPORT_LOCK
from app.ingest.ensure import _serialize_status, ensure_filings, scheme_codes_from_body
from app.ingest.run import resolve_ingest_files, run_ingest
from app.ingest.scheme_master import SchemeMaster
from app.ingest.upload import reject_filing, upload_filing
from app.insights import compute_insights
from app.portfolio import (
    DuplicateTransaction,
    add_manual_transaction,
    delete_manual_transaction,
    portfolio,
)
from app.portfolio_commission import commission_check

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
    app.state.cache_db_path = DB_PATH
    try:
        yield
    finally:
        conn.close()


app = FastAPI(lifespan=lifespan)
app.include_router(cas_router)


def _scheme_master(app: FastAPI) -> SchemeMaster:
    master = getattr(app.state, "scheme_master", None)
    if master is None:
        try:
            master = SchemeMaster.load_cached(DB_PATH.parent)
        except Exception:
            # A failed load must not be cached: a transient cache miss would
            # otherwise disable ISIN resolution until the API restarts.
            return SchemeMaster([])
        app.state.scheme_master = master
    return master


@app.get("/api/portfolio")
def get_portfolio(request: Request):
    return portfolio(request.app.state.db, _scheme_master(request.app))


def _run_commission_check(app: FastAPI, instrument_ids: object):
    cache_conn = None
    cache_path = getattr(app.state, "cache_db_path", None)
    if cache_path:
        try:
            cache_conn = connect_db(cache_path)
        except Exception:
            cache_conn = None
    try:
        return commission_check(
            app.state.db,
            _scheme_master(app),
            instrument_ids,
            cache_conn=cache_conn,
        )
    finally:
        if cache_conn is not None:
            cache_conn.close()


@app.post("/api/portfolio/commission-check")
async def post_portfolio_commission_check(request: Request):
    if not request.headers.get("content-type", "").lower().startswith("application/json"):
        raise HTTPException(status_code=415, detail="Expected application/json.")
    try:
        body = await request.json()
    except Exception:
        body = None
    instrument_ids = body.get("instrumentIds") if isinstance(body, dict) else None
    try:
        return await run_in_threadpool(
            _run_commission_check,
            request.app,
            instrument_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/portfolio/transactions")
async def post_portfolio_transaction(request: Request):
    # application/json forces a CORS preflight cross-origin, which this
    # middleware-less API refuses; text/plain bodies are not accepted.
    if not request.headers.get("content-type", "").lower().startswith("application/json"):
        raise HTTPException(status_code=415, detail="Expected application/json.")
    try:
        body = await request.json()
    except Exception:
        body = None
    # Shares the import lock so a hand entry cannot slip between a statement
    # row's duplicate check and its write. The lock can be held for a whole
    # CAS parse, so wait for it off the event loop.
    return await run_in_threadpool(_create_manual_transaction, request.app.state.db, body)


def _create_manual_transaction(db, body):
    with IMPORT_LOCK:
        try:
            return add_manual_transaction(db, body)
        except DuplicateTransaction as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.delete("/api/portfolio/transactions/{tx_id}")
def delete_portfolio_transaction(request: Request, tx_id: str):
    try:
        deleted = delete_manual_transaction(request.app.state.db, tx_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return {"deleted": True}


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


# Serialize ingest writers sharing app.state.db so concurrent threadpool
# requests never interleave delete/insert/commit sequences on the same connection.
_INGEST_LOCK = threading.Lock()


def _locked_run_ingest(db, *, month, files, notes, master):
    with _INGEST_LOCK:
        return run_ingest(db, month=month, files=files, notes=notes, master=master)


def _locked_ensure_filings(db, codes, *, incoming):
    with _INGEST_LOCK:
        return ensure_filings(db, codes, incoming=incoming)


def _locked_upload_filing(db, scheme, path, *, month):
    with _INGEST_LOCK:
        return upload_filing(db, scheme, path, month=month)


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
    return await run_in_threadpool(
        _locked_run_ingest,
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
    return await run_in_threadpool(
        _locked_ensure_filings,
        request.app.state.db,
        codes_s,
        incoming=DB_PATH.parent / "incoming",
    )


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
    message = reject_filing(name, len(data))
    if message:
        return JSONResponse(
            status_code=422,
            content={"error": "bad_request", "message": message},
        )
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(name).suffix.lower())
    try:
        tmp.write(data)
        tmp.close()
        status = await run_in_threadpool(
            _locked_upload_filing,
            request.app.state.db,
            scheme,
            Path(tmp.name),
            month=month,
        )
    except FileNotFoundError as exc:
        return JSONResponse(status_code=422, content={"error": "parse-failed", "message": str(exc)})
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"error": "bad_request", "message": str(exc)})
    except Exception:
        return JSONResponse(status_code=422, content={"error": "parse-failed", "message": "Could not read this filing."})
    finally:
        Path(tmp.name).unlink(missing_ok=True)
    return _serialize_status(status)
