from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.ingest.cas import import_cas

router = APIRouter()

# CAS statements are a few MB; cap the read so an oversized upload cannot
# exhaust API memory before the parser sees it.
CAS_MAX_BYTES = 25 * 1024 * 1024


@router.post("/api/portfolio/import/cas")
def post_portfolio_import_cas(request: Request, file: UploadFile = File(...), password: str = Form(...)):
    content = file.file.read(CAS_MAX_BYTES + 1)
    if len(content) > CAS_MAX_BYTES:
        raise HTTPException(status_code=413, detail="CAS PDF is too large (25 MB max).")
    return import_cas(request.app.state.db, content, password)
