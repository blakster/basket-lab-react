import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS schemes (
  scheme_code TEXT PRIMARY KEY,
  scheme_name TEXT NOT NULL,
  isin TEXT,
  amc TEXT,
  category TEXT,
  is_etf INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS holdings (
  as_of TEXT NOT NULL,
  scheme_code TEXT NOT NULL,
  isin TEXT,
  instrument_name TEXT NOT NULL,
  asset_class TEXT,
  sector TEXT,
  rating TEXT,
  market_cap_bucket TEXT,
  weight_pct REAL NOT NULL,
  PRIMARY KEY (as_of, scheme_code, isin, instrument_name)
);
CREATE TABLE IF NOT EXISTS fundamentals (
  as_of TEXT NOT NULL,
  scheme_code TEXT NOT NULL,
  expense_ratio REAL,
  pe REAL,
  aum_cr REAL,
  turnover REAL,
  PRIMARY KEY (as_of, scheme_code)
);
CREATE TABLE IF NOT EXISTS ingest_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  month TEXT NOT NULL,
  files_ok INTEGER NOT NULL,
  files_failed INTEGER NOT NULL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS commission_expense_cache (
  scheme_code TEXT PRIMARY KEY,
  expense_ratio REAL NOT NULL,
  expense_ratio_as_of TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS filing_status (
  scheme_code TEXT NOT NULL,
  requested_month TEXT NOT NULL,
  state TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  finished_at TEXT,
  as_of TEXT,
  amc TEXT,
  source_url TEXT,
  reason TEXT,
  PRIMARY KEY (scheme_code, requested_month)
);
CREATE TABLE IF NOT EXISTS mixes (
  as_of TEXT NOT NULL,
  scheme_code TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  weight_pct REAL NOT NULL,
  PRIMARY KEY (as_of, scheme_code, kind, label)
);
-- Portfolio domain tables (redesign proposal Phase 1). IDs are prefixed
-- strings: "amfi:122639", "nse:GOLDCASE", "manual:epf".
CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('mf','etf','stock','gold','epf','cash','ulip','other')),
  name TEXT NOT NULL,
  isin TEXT,
  symbol TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('zerodha','cams','kfintech','cdsl','nsdl','bank','epfo','manual')),
  label TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('buy','sell','sip','dividend','switch-in','switch-out')),
  units REAL NOT NULL,
  amount REAL NOT NULL,
  import_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_position
  ON transactions (account_id, instrument_id, date);
CREATE TABLE IF NOT EXISTS snapshots (
  date TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  units REAL NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (date, account_id, instrument_id)
);
"""


def connect_db(path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate_accounts_provider(conn):
    # CHECK constraints cannot be altered; rebuild accounts when it predates
    # depository providers.
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").fetchone()
    if row is None or "'cdsl'" in row["sql"]:
        return
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript("""
        BEGIN IMMEDIATE;
        CREATE TABLE accounts_new (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL CHECK (provider IN ('zerodha','cams','kfintech','cdsl','nsdl','bank','epfo','manual')),
          label TEXT NOT NULL
        );
        INSERT INTO accounts_new SELECT id, provider, label FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_new RENAME TO accounts;
        COMMIT;
        """)
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def init_db(path: str | Path) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = connect_db(path)
    conn.executescript(SCHEMA)
    _migrate_accounts_provider(conn)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(fundamentals)")}
    if "aum_cr" not in cols:
        conn.execute("ALTER TABLE fundamentals ADD COLUMN aum_cr REAL")
    if "turnover" not in cols:
        conn.execute("ALTER TABLE fundamentals ADD COLUMN turnover REAL")
    conn.commit()
    return conn
