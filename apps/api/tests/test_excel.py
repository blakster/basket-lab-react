from openpyxl import Workbook

from app.db import init_db
from app.ingest.excel import sheet_to_csv_rows
from app.ingest.run import run_ingest


def test_sheet_to_csv_rows_maps_amc_headers():
    wb = Workbook()
    ws = wb.active
    ws.append(["Name", "ISIN", "Industry", "% to NAV"])
    ws.append(["Reliance Industries", "INE002A01018", "Energy", 8.5])
    ws.append(["HDFC Bank", "INE040A01034", "Financial", 7.2])

    rows = sheet_to_csv_rows(ws)
    assert rows is not None
    assert len(rows) == 2
    assert rows[0]["isin"] == "INE002A01018"
    assert rows[0]["weight_pct"] == 8.5
    assert rows[1]["isin"] == "INE040A01034"
    assert rows[1]["weight_pct"] == 7.2
    assert rows[0]["instrument_name"] == "Reliance Industries"
    assert rows[0]["sector"] == "Energy"


def test_sheet_to_csv_rows_finds_header_below_title_and_maps_rating():
    wb = Workbook()
    ws = wb.active
    ws.append(["Portfolio disclosure"])
    ws.append(["As on 31-Jul-2026"])
    ws.append(["Name", "ISIN", "Industry", "Rating", "% to NAV"])
    ws.append(["GOI 7.18%", "IN002021001", "Sovereign", "SOV", 3.25])

    rows = sheet_to_csv_rows(ws)
    assert rows is not None
    assert len(rows) == 1
    assert rows[0]["isin"] == "IN002021001"
    assert rows[0]["weight_pct"] == 3.25
    assert rows[0]["rating"] == "SOV"
    assert rows[0]["instrument_name"] == "GOI 7.18%"


def test_sheet_to_csv_rows_returns_none_when_headers_missing():
    wb = Workbook()
    ws = wb.active
    ws.append(["Foo", "Bar"])
    ws.append(["1", "2"])

    assert sheet_to_csv_rows(ws) is None


def test_run_ingest_marks_file_failed_when_excel_headers_missing(tmp_path):
    wb = Workbook()
    wb.active.append(["Foo", "Bar"])
    path = tmp_path / "junk.xlsx"
    wb.save(path)

    conn = init_db(tmp_path / "basket.sqlite")
    result = run_ingest(conn, month="2026-07", files=[path])
    assert result["files_failed"] == 1
    assert result["files_ok"] == 0


def test_run_ingest_loads_canonical_xlsx(tmp_path):
    wb = Workbook()
    ws = wb.active
    ws.append(
        [
            "as_of",
            "scheme_code",
            "isin",
            "instrument_name",
            "asset_class",
            "sector",
            "rating",
            "market_cap_bucket",
            "weight_pct",
        ]
    )
    ws.append(
        [
            "2026-07-31",
            "122639",
            "INE002A01018",
            "Reliance Industries",
            "equity",
            "Energy",
            None,
            "large",
            8.5,
        ]
    )
    path = tmp_path / "canonical.xlsx"
    wb.save(path)

    conn = init_db(tmp_path / "basket.sqlite")
    result = run_ingest(conn, month="2026-07", files=[path])
    assert result["files_ok"] == 1
    assert result["files_failed"] == 0
    assert conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 1
