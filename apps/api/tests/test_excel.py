from openpyxl import Workbook

from app.db import init_db
from app.ingest.excel import extract_sheet_metrics, sheet_to_csv_rows
from app.ingest.run import run_ingest


def _icici_like_book(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "FLEXCAP"
    ws["A1"] = "ICICI Prudential Mutual Fund"
    ws["A2"] = "ICICI Prudential Flexicap Fund"
    ws["A3"] = "Portfolio as on Jul 31,2026"
    headers = [
        "Company/Issuer/Instrument Name", "ISIN", "Coupon", "Industry/Rating",
        "Quantity", "Exposure/Market Value(Rs.Lakh)", "% to Nav",
    ]
    for col, h in enumerate(headers, start=1):
        ws.cell(4, col, h)
    ws["A5"] = "Equity & Equity Related Instruments"
    ws["G5"] = 0.9677
    ws["A8"] = "TVS Motor Company Ltd."
    ws["B8"] = "INE494B01023"
    ws["D8"] = "Automobiles"
    ws["G8"] = 0.10057
    ws["A9"] = "TREPS"
    ws["F9"] = 63730.28
    ws["G9"] = 0.02644
    ws["A10"] = "Cash Margin - Derivatives"
    ws["G10"] = 0.00189
    ws["A11"] = "Total Net Assets"
    ws["F11"] = 2409978.38
    ws["G11"] = 1.0
    ws["A12"] = "6. Portfolio turnover Ratio "
    ws["B12"] = "0.26 times"
    wb.save(path)
    return path


def test_icici_sheet_extracts_holdings_cash_and_metrics(tmp_path):
    from openpyxl import load_workbook
    path = _icici_like_book(tmp_path / "icici.xlsx")
    ws = load_workbook(path, data_only=True)["FLEXCAP"]
    rows = sheet_to_csv_rows(ws)
    names = {r["instrument_name"] for r in rows}
    assert "TVS Motor Company Ltd." in names
    assert "Equity & Equity Related Instruments" not in names
    treps = next(r for r in rows if r["instrument_name"] == "TREPS")
    assert treps["asset_class"] == "treps"
    assert 2.6 < treps["weight_pct"] < 2.7
    cash = next(r for r in rows if "Cash Margin" in r["instrument_name"])
    assert cash["asset_class"] == "cash"
    metrics = extract_sheet_metrics(ws)
    assert metrics["as_of"] == "2026-07-31"
    assert 24099 < metrics["aum_cr"] < 24101
    assert metrics["turnover"] == 0.26


def test_icici_metrics_when_labels_start_in_column_b(tmp_path):
    """Official ICICI workbooks leave column A blank; labels start in B."""
    from openpyxl import load_workbook

    path = tmp_path / "icici-col-b.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "FLEXCAP"
    ws["B1"] = "ICICI Prudential Mutual Fund"
    ws["B2"] = "ICICI Prudential Flexicap Fund"
    ws["B3"] = "Portfolio as on Jul 31,2026"
    headers = [
        "Company/Issuer/Instrument Name", "ISIN", "Coupon", "Industry/Rating",
        "Quantity", "Exposure/Market Value(Rs.Lakh)", "% to Nav",
    ]
    for col, h in enumerate(headers, start=2):
        ws.cell(4, col, h)
    ws["B8"] = "TVS Motor Company Ltd."
    ws["C8"] = "INE494B01023"
    ws["H8"] = 0.10057
    ws["B9"] = "TREPS"
    ws["G9"] = 63730.28
    ws["H9"] = 0.02644
    ws["B11"] = "Total Net Assets"
    ws["G11"] = 2409978.38
    ws["H11"] = 1.0
    ws["B12"] = "6. Portfolio turnover Ratio "
    ws["C12"] = "0.26 times"
    wb.save(path)

    ws = load_workbook(path, data_only=True)["FLEXCAP"]
    metrics = extract_sheet_metrics(ws)
    assert metrics["as_of"] == "2026-07-31"
    assert 24099 < metrics["aum_cr"] < 24101
    assert metrics["turnover"] == 0.26
    rows = sheet_to_csv_rows(ws)
    assert any(r["instrument_name"] == "TREPS" for r in rows)


def test_sheet_to_csv_rows_reads_title_and_fractional_nav_weights():
    wb = Workbook()
    ws = wb.active
    ws.title = "PPFCF"
    ws.append(["Parag Parikh Flexi Cap Fund (An open-ended dynamic equity scheme)"])
    ws.append(["Monthly Portfolio Statement as on July 31, 2026"])
    ws.append(["Name of the Instrument", "ISIN", "Industry / Rating", "% to Net Assets"])
    ws.append(["HDFC Bank Limited", "INE040A01034", "Banks", 0.0755])
    ws.append(["Sub Total", None, None, 0.0755])

    rows = sheet_to_csv_rows(ws)
    assert rows is not None
    assert len(rows) == 1
    assert rows[0]["isin"] == "INE040A01034"
    assert rows[0]["weight_pct"] == 7.55
    assert rows[0]["sector"] == "Banks"
    assert "Parag Parikh Flexi Cap Fund" in (rows[0].get("scheme_name") or "")


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
