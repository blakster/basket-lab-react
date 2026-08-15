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
