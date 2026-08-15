from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import init_db
from app.ingest.run import download_amfi_month, resolve_ingest_files, run_ingest
from app.main import app

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "holdings"
SAMPLE = FIXTURES / "sample.csv"


@pytest.fixture(autouse=True)
def _clear_amfi_ingest(monkeypatch):
    monkeypatch.delenv("AMFI_INGEST", raising=False)


def test_run_ingest_sample(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    result = run_ingest(conn, month="2026-07", files=[SAMPLE])
    assert result["files_ok"] == 1
    assert result["files_failed"] == 0
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 4
    assert conn.execute("SELECT COUNT(*) FROM ingest_runs").fetchone()[0] == 1


def test_run_ingest_junk_and_sample_keeps_holdings(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    junk = tmp_path / "junk.csv"
    junk.write_text("not a valid holdings csv\nfoo,bar\n1,2\n")
    result = run_ingest(conn, month="2026-07", files=[junk, SAMPLE])
    assert result["files_failed"] == 1
    assert result["files_ok"] == 1
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 4


def test_download_amfi_month_skipped_without_flag(tmp_path, monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("httpx.get should not be called when AMFI_INGEST is unset")

    monkeypatch.setattr("httpx.get", boom)
    paths = download_amfi_month("2026-07", tmp_path / "dest")
    assert paths == []


def test_amfi_listing_unparsed_sets_notes(tmp_path, monkeypatch):
    monkeypatch.setenv("AMFI_INGEST", "1")

    class _Resp:
        text = "<html><body>no downloadable listing</body></html>"

        def raise_for_status(self):
            return None

    monkeypatch.setattr("httpx.get", lambda *_args, **_kwargs: _Resp())
    files, notes = resolve_ingest_files(month="2026-07", incoming=tmp_path)
    assert files == []
    assert notes == "amfi-listing-unparsed"

    conn = init_db(tmp_path / "basket.sqlite")
    result = run_ingest(conn, month="2026-07", files=files, notes=notes)
    row = conn.execute("SELECT notes FROM ingest_runs").fetchone()
    assert result["notes"] == "amfi-listing-unparsed"
    assert row[0] == "amfi-listing-unparsed"


def test_post_ingest_fixture(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    app.state.db = conn
    client = TestClient(app)
    res = client.post("/api/ingest", json={"source": "fixture"})
    assert res.status_code == 200
    body = res.json()
    assert body["files_ok"] == 1
    assert body["files_failed"] == 0
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 4
    conn.close()


def test_post_ingest_incoming(tmp_path, monkeypatch):
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    (incoming / "sample.csv").write_text(SAMPLE.read_text())
    monkeypatch.setattr("app.ingest.run.INCOMING_DIR", incoming)
    conn = init_db(tmp_path / "basket.sqlite")
    app.state.db = conn
    client = TestClient(app)
    res = client.post("/api/ingest", json={})
    assert res.status_code == 200
    assert res.json()["files_ok"] == 1
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 4
    conn.close()
