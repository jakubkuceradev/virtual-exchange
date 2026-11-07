"""Verify funded REST operations, reconciliation, and permission boundaries."""

import hashlib
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from virtual_exchange.api import create_app
from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.types import AuthenticatedIdentity, Instrument, Permission


@pytest.fixture
def api():
    instrument = Instrument("ABC-USD", "ABC", "USD", Decimal("0.01"), Decimal("0.1"))
    exchange = Exchange(
        instrument=instrument,
        allocations={
            "alice": (Decimal(1000), Decimal(0)),
            "bob": (Decimal(0), Decimal(10)),
        },
    )
    auth = Authenticator(
        credentials={
            hashlib.sha256(token.encode()).hexdigest(): AuthenticatedIdentity(
                account, frozenset(grants)
            )
            for token, account, grants in [
                ("alice", "alice", list(Permission)),
                ("bob", "bob", list(Permission)),
                ("reader", "alice", [Permission.READ]),
                ("trader", "alice", [Permission.TRADE]),
            ]
        }
    )
    with TestClient(create_app(authenticator=auth, exchange=exchange)) as client:
        yield client


def headers(token="alice"):
    return {"Authorization": "Bearer " + token}


def body(side="buy", quantity="2", price="100", client=None):
    return {
        "instrument_id": "ABC-USD",
        "side": side,
        "quantity": quantity,
        "price": price,
        "client_order_id": client,
    }


def test_real_http_trade_and_anonymous_observations(api):
    sell = api.post("/orders", headers=headers("bob"), json=body("sell"))
    buy = api.post("/orders", headers=headers(), json=body())
    assert sell.status_code == buy.status_code == 201
    assert set(buy.json()) == {
        "order_id",
        "client_order_id",
        "accepted_at",
        "process_id",
    }
    balances = api.get("/balances", headers=headers()).json()["data"]
    assert {b["asset_id"]: Decimal(b["available"]) for b in balances} == {
        "USD": Decimal(800),
        "ABC": Decimal(2),
    }
    assert (
        api.get("/orders/" + buy.json()["order_id"], headers=headers()).json()["data"][
            "status"
        ]
        == "filled"
    )
    trade = api.get("/trades", headers={"Authorization": "invalid optional"}).json()[
        "data"
    ][0]
    assert trade["maker_order_id"] == sell.json()["order_id"]
    assert "account_id" not in trade and "client_order_id" not in trade
    assert api.get("/book").json()["data"]["asks"] == []
    assert api.get("/instruments").status_code == 200
    assert len(api.get("/fills", headers=headers()).json()["data"]) == 1
    assert (
        api.delete("/orders/" + buy.json()["order_id"], headers=headers()).status_code
        == 409
    )


def test_client_lookup_lost_response_and_duplicate_no_effect(api):
    client = str(uuid4())
    api.post(
        "/orders", headers=headers(), json=body(client=client)
    )  # Simulate discarded response.
    lookup = api.get("/orders/client:" + client, headers=headers()).json()["data"]
    before = api.get("/account/snapshot", headers=headers()).json()
    assert api.post("/orders", headers=headers(), json=body(client=client)).json() == {
        "error": "duplicate_client_id"
    }
    assert api.get("/account/snapshot", headers=headers()).json() == before
    assert (
        api.get("/orders/" + lookup["order_id"], headers=headers("bob")).status_code
        == 404
    )
    assert api.delete(
        "/orders/" + lookup["order_id"], headers=headers("bob")
    ).json() == {"error": "order_not_found"}
    assert (
        api.get("/orders/client:" + client, headers=headers("bob")).status_code == 404
    )
    assert (
        api.delete("/orders/" + lookup["order_id"], headers=headers()).status_code
        == 200
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"price": 100.0},
        {"quantity": 2},
        {"price": "NaN"},
        {"quantity": "0"},
        {"price": "100.001"},
        {"client_order_id": "invalid"},
        {"type": "market"},
        {"account_id": "bob"},
        {"side": "invalid"},
    ],
)
def test_bad_requests_no_effect_or_input_echo(api, changes):
    before = api.get("/account/snapshot", headers=headers()).json()
    response = api.post("/orders", headers=headers(), json={**body(), **changes})
    assert response.status_code == 400
    assert set(response.json()) == {"error"}
    assert api.get("/account/snapshot", headers=headers()).json() == before


def test_permissions_and_rejections(api):
    assert (
        api.post("/orders", headers=headers("reader"), json=body()).status_code == 403
    )
    assert api.get("/balances", headers=headers("trader")).status_code == 403
    assert api.get("/orders").status_code == 401
    assert (
        api.post("/orders", headers=headers(), json=body(quantity="11")).status_code
        == 409
    )
    first = api.post("/orders", headers=headers(), json=body(quantity="7")).json()
    before = api.get("/balances", headers=headers()).json()
    assert (
        api.post("/orders", headers=headers(), json=body(quantity="4")).status_code
        == 409
    )
    assert api.get("/balances", headers=headers()).json() == before
    assert (
        api.delete("/orders/" + first["order_id"], headers=headers()).status_code == 200
    )


def test_pagination_scope_and_fill_watermark(api):
    for _ in range(3):
        assert (
            api.post("/orders", headers=headers(), json=body(quantity="1")).status_code
            == 201
        )
    first = api.get("/orders?limit=1", headers=headers()).json()
    assert first["next_cursor"]
    assert (
        len(
            api.get(
                "/orders", params={"cursor": first["next_cursor"]}, headers=headers()
            ).json()["data"]
        )
        == 2
    )
    assert (
        api.get(
            "/orders", params={"cursor": first["next_cursor"]}, headers=headers("bob")
        ).status_code
        == 400
    )
    assert api.get("/orders?limit=1001", headers=headers()).status_code == 400
    assert api.get("/fills?high_watermark=-1", headers=headers()).status_code == 400


def test_unconfigured_trading_preserves_health_and_identity(monkeypatch):
    monkeypatch.delenv("EXCHANGE_TRADING_CONFIG", raising=False)
    auth = Authenticator(
        credentials={
            hashlib.sha256(b"test").hexdigest(): AuthenticatedIdentity(
                "alice", frozenset(Permission)
            )
        }
    )
    with TestClient(create_app(authenticator=auth)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/identity", headers=headers("test")).status_code == 200
        assert client.get("/book").status_code == 503
        assert (
            client.post("/orders", headers=headers("test"), json=body()).status_code
            == 503
        )


def test_authentication_precedes_malformed_body(api):
    response = api.post(
        "/orders", content="{invalid JSON", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 401
    response = api.post(
        "/orders",
        content="{invalid JSON",
        headers={**headers(), "Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json() == {"error": "invalid_request"}
