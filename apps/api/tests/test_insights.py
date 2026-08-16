from app.insights import _rating_bucket


def test_rating_bucket_agency_prefix_and_unknown():
    assert _rating_bucket("CRISIL AAA") == "AAA"
    assert _rating_bucket("ICRA AA+") == "AA"
    assert _rating_bucket("SOV") == "Unrated"
    assert _rating_bucket("AAA") == "AAA"
    assert _rating_bucket("BB") == "Below BBB"
    assert _rating_bucket(None) == "Unrated"


def test_one_basket_reliance_credit_pe(client):
    res = client.post(
        "/api/insights",
        json={
            "baskets": [
                {
                    "id": "1",
                    "name": "Core",
                    "funds": [{"schemeCode": "122639", "weight": 100}],
                }
            ]
        },
    )
    assert res.status_code == 200
    data = res.json()
    basket = data["baskets"][0]
    reliance = next(h for h in basket["holdings"] if h["name"] == "Reliance Industries")
    assert reliance["isin"] == "INE002A01018"
    assert reliance["weight"] == 8.5
    assert basket["sector"] == {
        "Energy": 8.5,
        "Financial": 7.2,
        "Unclassified": 4.0,
    }
    assert basket["asset"] == {"equity": 15.7, "cash": 4.0}
    assert basket["equitySplit"]["large"] == 15.7
    assert basket["equitySplit"]["mid"] == 0
    assert basket["equitySplit"]["small"] == 0
    assert basket["equitySplit"]["unclassified"] == 0
    assert basket["credit"] is None
    assert basket["pe"] is None
    assert data["asOf"] == "2026-07-31"
    assert data["overlap"] is None


def test_two_baskets_overlap(client):
    res = client.post(
        "/api/insights",
        json={
            "baskets": [
                {
                    "id": "1",
                    "name": "Core",
                    "funds": [{"schemeCode": "122639", "weight": 100}],
                },
                {
                    "id": "2",
                    "name": "Satellite",
                    "funds": [{"schemeCode": "140084", "weight": 100}],
                },
            ]
        },
    )
    assert res.status_code == 200
    overlap = res.json()["overlap"]
    assert overlap is not None
    # Only common ISIN is Reliance: min(8.5, 10.1) = 8.5
    assert overlap["1|2"] == 8.5


def test_pe_json_null_not_zero(client):
    res = client.post(
        "/api/insights",
        json={
            "baskets": [
                {
                    "id": "1",
                    "name": "Core",
                    "funds": [{"schemeCode": "122639", "weight": 100}],
                }
            ]
        },
    )
    assert res.status_code == 200
    assert res.json()["baskets"][0]["pe"] is None
    compact = "".join(res.text.split())
    assert '"pe":null' in compact
    assert '"pe":0' not in compact


def test_baskets_required_422(client):
    res = client.post("/api/insights", json={})
    assert res.status_code == 422
    assert res.json() == {"error": "bad_request", "message": "baskets required"}


def test_insights_include_aum_and_overlap_names(db, client):
    db.execute(
        "INSERT INTO holdings (as_of, scheme_code, isin, instrument_name, asset_class, sector, rating, market_cap_bucket, weight_pct) VALUES (?,?,?,?,?,?,?,?,?)",
        ("2026-07-31", "A", "INE1", "HDFC Bank", "equity", "Banks", None, None, 3.44),
    )
    db.execute(
        "INSERT INTO holdings (as_of, scheme_code, isin, instrument_name, asset_class, sector, rating, market_cap_bucket, weight_pct) VALUES (?,?,?,?,?,?,?,?,?)",
        ("2026-07-31", "B", "INE1", "HDFC Bank", "equity", "Banks", None, None, 0.94),
    )
    db.execute(
        "INSERT INTO fundamentals (as_of, scheme_code, expense_ratio, pe, aum_cr, turnover) VALUES (?,?,?,?,?,?)",
        ("2026-07-31", "A", None, None, 24100.0, 0.26),
    )
    db.commit()
    res = client.post("/api/insights", json={
        "baskets": [
            {"id": "1", "funds": [{"schemeCode": "A", "weight": 100}]},
            {"id": "2", "funds": [{"schemeCode": "B", "weight": 100}]},
        ]
    })
    body = res.json()
    one = next(b for b in body["baskets"] if b["id"] == "1")
    assert one["aumCr"] == 24100.0
    assert one["turnover"] == 0.26
    assert one["fundMetrics"][0]["schemeCode"] == "A"
    names = body["overlapHoldings"]["1|2"]
    assert names[0]["isin"] == "INE1"
    assert names[0]["minWeight"] == 0.94
