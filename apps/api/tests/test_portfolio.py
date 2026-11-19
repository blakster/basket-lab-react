from datetime import date

import pytest


def test_manual_asset_lifecycle(client, db):
    assert client.get('/api/manual-assets').json() == []
    payload = {"name": "My Savings", "kind": "savings", "value": 100, "date": "2025-02-01"}
    asset = client.post('/api/manual-assets', json=payload).json()
    assert asset == {
        "id": "manual:my-savings", "name": "My Savings", "kind": "cash",
        "latest": {"date": "2025-02-01", "value": 100},
        "history": [{"date": "2025-02-01", "value": 100}],
    }
    assert db.execute('SELECT units FROM snapshots').fetchone()[0] == 0
    assert tuple(db.execute('SELECT * FROM accounts').fetchone()) == ('manual', 'manual', 'Manual')
    client.post('/api/manual-assets', json={**payload, "value": 120, "units": 2})
    response = client.post('/api/manual-assets', json={
        **payload, "name": "MY SAVINGS", "kind": "gold", "value": 80, "date": "2025-01-01",
    })
    assert response.status_code == 200
    asset = response.json()
    assert asset['name'] == 'MY SAVINGS'
    assert asset['kind'] == 'gold'
    assert asset['latest'] == {"date": "2025-02-01", "value": 120}
    assert asset['history'] == [{"date": "2025-01-01", "value": 80}, {"date": "2025-02-01", "value": 120}]
    assert client.get('/api/manual-assets').json() == [asset]
    assert client.delete('/api/manual-assets/manual:my-savings').json() == {"ok": True}
    assert client.delete('/api/manual-assets/manual:my-savings').status_code == 404
    assert client.get('/api/manual-assets').json() == []
    assert db.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0] == 0
    assert db.execute('SELECT COUNT(*) FROM instruments').fetchone()[0] == 0


@pytest.mark.parametrize('kind', ['cash', 'epf', 'ulip', 'gold'])
def test_defaults_and_kinds(client, kind):
    response = client.post('/api/manual-assets', json={"name": kind, "kind": kind, "value": 0})
    assert response.status_code == 200
    assert response.json()['latest'] == {"date": date.today().isoformat(), "value": 0}


@pytest.mark.parametrize('change', [
    {"name": ""}, {"name": "---"}, {"name": None}, {"name": 1},
    {"kind": "stock"}, {"kind": []}, {"value": -1}, {"value": "10"},
    {"value": None}, {"value": True}, {"units": "2"}, {"units": -1},
    {"date": "2025-2-01"}, {"date": "2025-02-30"}, {"date": 20250101},
])
def test_invalid_fields(client, change):
    response = client.post('/api/manual-assets', json={"name": "Test", "kind": "cash", "value": 1, **change})
    assert response.status_code == 422
    assert response.json()['error'] == 'bad_request'
    assert response.json()['message']
    assert client.get('/api/manual-assets').json() == []


@pytest.mark.parametrize('body', ['null', '[]', '{}', '{', '{"name":"Test","kind":"cash","value":NaN}',
                                      '{"name":"Test","kind":"cash","value":Infinity}'])
def test_invalid_bodies(client, body):
    response = client.post('/api/manual-assets', content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()['error'] == 'bad_request'


def test_networth(client, db):
    assert client.get('/api/portfolio/networth?date=2024-01-01').json() == {
        "asOf": "2024-01-01", "total": 0, "byKind": {}, "items": [],
    }
    for kind, value in [('cash', 10), ('epf', 20), ('ulip', 30), ('gold', 40)]:
        client.post('/api/manual-assets', json={"name": kind, "kind": kind, "value": value, "date": "2025-01-01"})
    client.post('/api/manual-assets', json={"name": "cash", "kind": "cash", "value": 100, "date": "2025-03-01"})
    db.execute("INSERT INTO accounts VALUES ('bank', 'bank', 'Bank')")
    db.execute("INSERT INTO snapshots VALUES ('2025-01-15', 'bank', 'manual:cash', 0, 5)")
    db.execute("INSERT INTO instruments (id, name, kind) VALUES ('nse:test', 'Test stock', 'stock')")
    db.execute("INSERT INTO snapshots VALUES ('2025-01-15', 'bank', 'nse:test', 2, 50)")
    db.execute("INSERT INTO snapshots VALUES ('2025-04-01', 'bank', 'nse:test', 2, 70)")
    db.commit()
    result = client.get('/api/portfolio/networth?date=2025-01-15').json()
    assert result['asOf'] == '2025-01-15'
    assert result['total'] == 155
    assert result['byKind'] == {"cash": 15, "epf": 20, "ulip": 30, "gold": 40, "stock": 50}
    assert len(result['items']) == 6
    assert {"accountId": "bank", "instrumentId": "nse:test", "name": "Test stock", "kind": "stock",
            "date": "2025-01-15", "value": 50} in result['items']
    assert client.get('/api/portfolio/networth?date=2025-01-14').json()['total'] == 100
    latest = client.get('/api/portfolio/networth').json()
    assert latest['asOf'] == date.today().isoformat()
    assert latest['total'] == 260
    assert client.get('/api/portfolio/networth?date=2025-01-01').json()['total'] == 100
    assert client.delete('/api/manual-assets/nse:test').status_code == 404


@pytest.mark.parametrize('value', ['2025-2-01', '2025-02-30', 'bad', ''])
def test_invalid_networth_date(client, value):
    response = client.get('/api/portfolio/networth', params={"date": value})
    assert response.status_code == 422
    assert response.json()['error'] == 'bad_request'


def test_networth_full_account_snapshots(client, db):
    db.execute("INSERT INTO accounts VALUES ('zerodha', 'zerodha', 'Zerodha')")
    db.execute("INSERT INTO instruments (id, name, kind) VALUES ('nse:A', 'A', 'stock')")
    db.execute("INSERT INTO instruments (id, name, kind) VALUES ('nse:B', 'B', 'stock')")
    db.executemany(
        'INSERT INTO snapshots VALUES (?, ?, ?, ?, ?)',
        [('2025-01-01', 'zerodha', 'nse:A', 1, 100),
         ('2025-01-01', 'zerodha', 'nse:B', 2, 200),
         ('2025-02-01', 'zerodha', 'nse:A', 1, 150)],
    )
    db.commit()
    client.post('/api/manual-assets', json={
        'name': 'Savings', 'kind': 'cash', 'value': 10, 'date': '2025-01-01',
    })
    client.post('/api/manual-assets', json={
        'name': 'EPF', 'kind': 'epf', 'value': 20, 'date': '2025-02-01',
    })
    day1 = client.get('/api/portfolio/networth?date=2025-01-01').json()
    assert day1['total'] == 310
    assert day1['byKind'] == {'stock': 300, 'cash': 10}
    assert {item['instrumentId'] for item in day1['items']} == {'nse:A', 'nse:B', 'manual:savings'}
    day2 = client.get('/api/portfolio/networth?date=2025-02-01').json()
    assert day2['total'] == 180
    assert day2['byKind'] == {'stock': 150, 'cash': 10, 'epf': 20}
    assert {item['instrumentId'] for item in day2['items']} == {'nse:A', 'manual:savings', 'manual:epf'}
