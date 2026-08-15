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
"""


def init_db(path: str | Path) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn
