from openpyxl import Workbook

from app.db import init_db
from app.ingest.run import run_ingest
from app.ingest.scheme_master import SchemeMaster, join_scheme_codes


def test_join_stamps_scheme_code_from_scheme_name():
    master = SchemeMaster.from_rows(
        [
            {
                "scheme_code": "122639",
                "scheme_name": "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
                "isin": "INF879O01027",
            }
        ]
    )
    rows = [
        {
            "scheme_name": "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
            "isin": "INE002A01018",
            "instrument_name": "Reliance Industries",
            "weight_pct": 8.5,
        }
    ]
    out = join_scheme_codes(rows, master, month="2026-07")
    assert len(out) == 1
    assert out[0]["scheme_code"] == "122639"
    assert out[0]["as_of"] == "2026-07-31"
    assert out[0]["isin"] == "INE002A01018"


def test_join_does_not_treat_holding_isin_as_scheme():
    master = SchemeMaster.from_rows(
        [
            {
                "scheme_code": "118741",
                "scheme_name": "UTI Nifty 50 Index Fund - Direct Plan - Growth",
                "isin": "INF789F01XA0",
            }
        ]
    )
    rows = [
        {
            "isin": "INE002A01018",
            "instrument_name": "Reliance Industries",
            "weight_pct": 10.1,
        }
    ]
    assert join_scheme_codes(rows, master, month="2026-07") == []


def test_lookup_prefers_direct_when_sheet_omits_plan():
    master = SchemeMaster.from_rows(
        [
            {
                "scheme_code": "118742",
                "scheme_name": "Nippon India Index Fund - Nifty 50 Plan - Growth",
                "isin": "INF1",
            },
            {
                "scheme_code": "118741",
                "scheme_name": "Nippon India Index Fund - Nifty 50 Plan - Direct Plan Growth Plan - Growth Option",
                "isin": "INF2",
            },
        ]
    )
    assert (
        master.lookup(scheme_name="NIPPON INDIA INDEX FUND - NIFTY 50 PLAN")
        == "118741"
    )


def test_join_prefers_direct_growth_when_names_collide():
    master = SchemeMaster.from_rows(
        [
            {
                "scheme_code": "1",
                "scheme_name": "Foo Fund - Regular Plan - Growth",
                "isin": "INF1",
            },
            {
                "scheme_code": "2",
                "scheme_name": "Foo Fund - Direct Plan - Growth",
                "isin": "INF2",
            },
        ]
    )
    rows = [{"scheme_name": "Foo Fund", "isin": "INE1", "weight_pct": 1.0}]
    out = join_scheme_codes(rows, master, month="2026-07")
    assert out[0]["scheme_code"] == "2"


def test_ingest_amc_xlsx_joins_sheet_title(tmp_path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Parag Parikh Flexi Cap Fund - Direct Plan - Growth"
    ws.append(["Name", "ISIN", "Industry", "% to NAV"])
    ws.append(["Reliance Industries", "INE002A01018", "Energy", 8.5])
    path = tmp_path / "ppfas.xlsx"
    wb.save(path)

    master = SchemeMaster.from_rows(
        [
            {
                "scheme_code": "122639",
                "scheme_name": "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
                "isin": "INF879O01027",
            }
        ]
    )
    conn = init_db(tmp_path / "basket.sqlite")
    result = run_ingest(conn, month="2026-07", files=[path], master=master)
    assert result["files_ok"] == 1
    row = conn.execute(
        "SELECT scheme_code, as_of, instrument_name, weight_pct FROM holdings"
    ).fetchone()
    assert tuple(row) == ("122639", "2026-07-31", "Reliance Industries", 8.5)
