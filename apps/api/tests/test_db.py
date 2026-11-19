from app.db import init_db


def test_init_db_creates_tables(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert names >= {"schemes", "holdings", "fundamentals", "ingest_runs"}


def test_init_db_creates_domain_tables(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert names >= {"instruments", "accounts", "transactions", "snapshots"}


def test_init_db_domain_tables_on_existing_db(tmp_path):
    path = tmp_path / "basket.sqlite"
    init_db(path).close()
    conn = init_db(path)  # second run must not fail or drop data
    conn.execute("INSERT INTO instruments (id, kind, name) VALUES ('amfi:122639', 'mf', 'Test Fund')")
    conn.execute("INSERT INTO accounts (id, provider, label) VALUES ('acc1', 'zerodha', 'Zerodha')")
    conn.execute(
        "INSERT INTO transactions (id, account_id, instrument_id, date, kind, units, amount, import_id)"
        " VALUES ('t1', 'acc1', 'amfi:122639', '2026-01-15', 'buy', 10.0, 5000.0, 'imp1')"
    )
    conn.execute(
        "INSERT INTO snapshots (date, account_id, instrument_id, units, value)"
        " VALUES ('2026-01-31', 'acc1', 'amfi:122639', 10.0, 5100.0)"
    )
    conn.commit()
    init_db(path).close()  # schema re-run on a populated DB
    conn = init_db(path)
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 1
