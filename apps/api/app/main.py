from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.db import init_db
from app.ingest.run import resolve_ingest_files, run_ingest
from app.insights import compute_insights

# apps/api/app/main.py → repo root / data / basket.sqlite
DB_PATH = Path(__file__).resolve().parents[3] / "data" / "basket.sqlite"


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = init_db(DB_PATH)
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
    return compute_insights(request.app.state.db, body)


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
    return run_ingest(request.app.state.db, month=month, files=files, notes=notes)
