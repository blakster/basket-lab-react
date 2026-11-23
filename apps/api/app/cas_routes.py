from fastapi import APIRouter, File, Form, Request, UploadFile

from app.ingest.cas import import_cas

router = APIRouter()


@router.post("/api/portfolio/import/cas")
def post_portfolio_import_cas(request: Request, file: UploadFile = File(...), password: str = Form(...)):
    return import_cas(request.app.state.db, file.file.read(), password)
