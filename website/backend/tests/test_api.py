"""Exercise the website application with a mocked exchange transport."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx2
import pytest
from fastapi.testclient import TestClient

from pqc_website.api import create_app, sample
from pqc_website.competition import Competition
from pqc_website.exchange_client import AccountRow, ExchangeClient
from pqc_website.store import Store

D = Decimal
CREATED = datetime(2026, 1, 1, tzinfo=UTC)
TOKENS = {"Bearer alice-token": "alice", "Bearer carol-token": "carol"}


class FakeExchange:
    """Answer the published exchange routes the backend uses."""

    def __init__(self):
        self.accounts = [
            ("alice", "funded", "1000", "0", 0),
            ("bob", "funded", "1000", "0", 0),
            ("carol", "unlimited", "0", "0", 0),
            ("dave", "funded", "1000", "0", 0),
        ]
        self.bids, self.asks, self.trades = ["99"], ["101"], []
        self.requests = []

    def rows(self):
        return [
            AccountRow(a, f == "funded", CREATED, D(c), D(q), n)
            for a, f, c, q, n in self.accounts
        ]

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/accounts":
            assert request.headers["Authorization"] == "Bearer observer"
            rows = [
                {
                    "account_id": a,
                    "funding": f,
                    "created_at": CREATED.isoformat(),
                    "cash": c,
                    "asset": q,
                    "fill_count": n,
                }
                for a, f, c, q, n in self.accounts
            ]
            return httpx2.Response(200, json={"commit_id": 1, "data": rows})
        if path == "/book":
            book = {
                "bids": [{"price": p, "quantity": "1"} for p in self.bids],
                "asks": [{"price": p, "quantity": "1"} for p in self.asks],
            }
            return httpx2.Response(200, json={"data": book})
        if path == "/trades":
            trades = [{"price": p} for p in self.trades]
            return httpx2.Response(200, json={"data": trades})
        if path == "/identity":
            account = TOKENS.get(request.headers.get("Authorization"))
            if account is None:
                return httpx2.Response(401, json={"error": "invalid_token"})
            return httpx2.Response(200, json={"account_id": account, "permissions": []})
        return httpx2.Response(404, json={"error": "not_found"})


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def setup():
    fake = FakeExchange()
    http = httpx2.AsyncClient(
        transport=httpx2.MockTransport(fake), base_url="http://exchange"
    )
    competition = Competition(Store.memory())
    exchange = ExchangeClient(http, "observer")
    app = create_app(competition=competition, exchange=exchange, sample_interval=None)
    return fake, competition, exchange, app


PRICE = D(100)


def tick(competition, fake, now, price=PRICE):
    competition.observe(now, fake.rows(), price)


def ranked_state(fake, competition):
    now = datetime.now(UTC) - timedelta(seconds=30)
    tick(competition, fake, now)
    fake.accounts = [
        ("alice", "funded", "1100", "0", 1),
        ("bob", "funded", "950", "0", 1),
        ("carol", "unlimited", "5000", "-40", 1),
        ("dave", "funded", "1000", "0", 0),
    ]
    tick(competition, fake, now + timedelta(seconds=10))


def test_health_reports_liveness():
    with TestClient(create_app()) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(
    "path", ["/does-not-exist", "/orders", "/docs", "/openapi.json"]
)
def test_unimplemented_routes_are_not_exposed(path):
    with TestClient(create_app()) as client:
        assert client.get(path).status_code == 404


def test_competition_is_unavailable_without_configuration(monkeypatch):
    monkeypatch.delenv("WEBSITE_STATE_DIR", raising=False)
    with TestClient(create_app()) as client:
        response = client.get("/competition/leaderboard")
    assert response.status_code == 503
    assert response.json() == {"error": "competition_unavailable"}


@pytest.mark.anyio
async def test_sample_reads_published_routes_and_prefers_the_mid(setup):
    fake, competition, exchange, _ = setup
    await sample(competition, exchange)
    assert competition.snapshot.mark == D(100)
    fake.asks = []
    fake.trades = ["97"]
    await sample(competition, exchange)
    assert competition._marks.samples[-1][1] == D(97)
    assert [r.url.path for r in fake.requests] == [
        "/accounts",
        "/book",
        "/accounts",
        "/book",
        "/trades",
    ]


def test_public_leaderboard_exposes_only_rank_account_and_return(setup):
    fake, competition, _, app = setup
    ranked_state(fake, competition)
    with TestClient(app) as client:
        response = client.get("/competition/leaderboard")
    assert response.status_code == 200
    body = response.json()
    weekly = body["periods"]["weekly"]
    assert weekly["participant_count"] == 2
    assert weekly["rows"] == [
        {"rank": 1, "account_id": "alice", "return_percent": "10.000000"},
        {"rank": 2, "account_id": "bob", "return_percent": "-5.000000"},
    ]
    assert set(body["periods"]) == {"continuous", "weekly", "monthly", "yearly"}
    # Criterion 7: no balances, holdings or values anywhere in public output.
    text = json.dumps(body)
    for leaked in ("cash", "asset", "value", "1100", "950", "5000"):
        assert leaked not in text


def test_caller_sees_value_rank_neighbourhood_and_unranked_reason(setup):
    fake, competition, _, app = setup
    ranked_state(fake, competition)
    alice_auth = {"Authorization": "Bearer alice-token"}
    with TestClient(app) as client:
        assert client.get("/competition/me").status_code == 401
        bad = client.get("/competition/me", headers={"Authorization": "Bearer x"})
        assert (bad.status_code, bad.json()) == (401, {"error": "invalid_token"})
        alice = client.get("/competition/me", headers=alice_auth).json()
        carol = client.get(
            "/competition/me", headers={"Authorization": "Bearer carol-token"}
        ).json()
        series = client.get("/competition/me/series", headers=alice_auth).json()
    assert alice["value"] == "1100.00000000"
    weekly = alice["periods"]["weekly"]
    assert (weekly["rank"], weekly["return_percent"]) == (1, "10.000000")
    assert weekly["baseline_value"] == "1000.00000000"
    assert [row["account_id"] for row in weekly["neighbourhood"]] == ["alice", "bob"]
    assert carol["funding"] == "unlimited"
    assert carol["periods"]["weekly"]["rank"] is None
    assert carol["periods"]["weekly"]["unranked_reason"] == "not_funded"
    assert carol["periods"]["weekly"]["neighbourhood"] == []
    assert series["interval_seconds"] == 600
    assert series["points"][0]["value"] == "1000.00000000"


def test_stale_rankings_are_unavailable(setup):
    fake, competition, _, app = setup
    tick(competition, fake, datetime.now(UTC) - timedelta(minutes=3))
    with TestClient(app) as client:
        response = client.get("/competition/leaderboard")
    assert (response.status_code, response.json()) == (
        503,
        {"error": "rankings_unavailable"},
    )


def test_frozen_standings_are_listed_and_named_by_local_start(setup):
    fake, competition, _, app = setup
    monday = datetime(2026, 11, 8, 23, 0, tzinfo=UTC)
    tick(competition, fake, monday - timedelta(days=7, seconds=10))
    tick(competition, fake, monday - timedelta(days=7))
    fake.accounts[0] = ("alice", "funded", "1100", "0", 1)
    tick(competition, fake, monday - timedelta(seconds=10))
    tick(competition, fake, monday)
    with TestClient(app) as client:
        listing = client.get("/competition/standings?period=weekly").json()["data"]
        detail = client.get(
            f"/competition/standings/weekly/{listing[0]['local_start']}"
        )
        missing = client.get("/competition/standings/weekly/2026-11-03")
    assert listing[0]["local_start"] == "2026-11-02"
    assert detail.json()["rows"] == [
        {"rank": 1, "account_id": "alice", "return_percent": "10.000000"}
    ]
    assert missing.status_code == 404
