from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import init_db
from app.ingest.parse import load_holdings, parse_holdings_csv
from app.main import app

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "holdings"
SAMPLE_CSV = (FIXTURES / "sample.csv").read_text()


@pytest.fixture
def db(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    load_holdings(conn, parse_holdings_csv(SAMPLE_CSV))
    yield conn
    conn.close()


@pytest.fixture
def client(db):
    app.state.db = db
    app.state.cache_db_path = db.execute("PRAGMA database_list").fetchone()[2]
    return TestClient(app)
