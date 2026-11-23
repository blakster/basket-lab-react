from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.ingest.cas import import_cas
from app.ingest.upload import MAX_BYTES

router = APIRouter()

# CAS statements run larger than portfolio filings; cap the read at 4x the
# filing limit so an oversized upload cannot exhaust API memory.
CAS_MAX_BYTES = MAX_BYTES * 4


@router.post("/api/portfolio/import/cas")
def post_portfolio_import_cas(request: Request, file: UploadFile = File(...), password: str = Form(...)):
    content = file.file.read(CAS_MAX_BYTES + 1)
    if len(content) > CAS_MAX_BYTES:
        raise HTTPException(status_code=413, detail="CAS PDF is too large.")
    return import_cas(request.app.state.db, content, password)
