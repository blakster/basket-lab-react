from app.db import init_db


def test_init_db_creates_tables(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert names >= {"schemes", "holdings", "fundamentals", "ingest_runs"}
