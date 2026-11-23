import sqlite3
import threading

import pytest

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


def test_accounts_provider_migration_preserves_rows(tmp_path):
    path = tmp_path / "basket.sqlite"
    conn = init_db(path)
    # Rebuild accounts with the pre-depository CHECK to mimic an existing DB.
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.executescript("""
    BEGIN IMMEDIATE;
    CREATE TABLE accounts_old (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('zerodha','cams','kfintech','bank','epfo','manual')),
      label TEXT NOT NULL
    );
    INSERT INTO accounts_old SELECT id, provider, label FROM accounts;
    DROP TABLE accounts;
    ALTER TABLE accounts_old RENAME TO accounts;
    COMMIT;
    """)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("INSERT INTO instruments (id, kind, name) VALUES ('amfi:122639', 'mf', 'Test Fund')")
    conn.execute("INSERT INTO accounts (id, provider, label) VALUES ('cams:123', 'cams', 'CAMS folio')")
    conn.execute(
        "INSERT INTO transactions (id, account_id, instrument_id, date, kind, units, amount, import_id)"
        " VALUES ('t1', 'cams:123', 'amfi:122639', '2026-01-15', 'buy', 10.0, 5000.0, 'imp1')"
    )
    conn.execute(
        "INSERT INTO snapshots (date, account_id, instrument_id, units, value)"
        " VALUES ('2026-01-31', 'cams:123', 'amfi:122639', 10.0, 5100.0)"
    )
    conn.commit()
    conn.close()
    conn = init_db(path)
    assert conn.execute("SELECT provider FROM accounts WHERE id = 'cams:123'").fetchone()[0] == "cams"
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1
    conn.execute("INSERT INTO accounts (id, provider, label) VALUES ('cdsl:demat:1', 'cdsl', 'CDSL')")
    conn.execute("INSERT INTO accounts (id, provider, label) VALUES ('nsdl:demat:1', 'nsdl', 'NSDL')")
    conn.commit()


def test_domain_foreign_keys_enforced(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO transactions (id, account_id, instrument_id, date, kind, units, amount, import_id)"
            " VALUES ('t1', 'missing-acc', 'missing-inst', '2026-01-15', 'buy', 1.0, 1.0, 'imp1')"
        )


def test_foreign_keys_pragma_on(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_connection_usable_from_other_thread(tmp_path):
    conn = init_db(tmp_path / "basket.sqlite")
    errors: list[Exception] = []

    def ping() -> None:
        try:
            conn.execute("SELECT 1").fetchone()
        except Exception as exc:
            errors.append(exc)

    worker = threading.Thread(target=ping)
    worker.start()
    worker.join()
    assert errors == []
