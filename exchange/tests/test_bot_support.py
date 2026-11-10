"""Verify features automated traders need: maker side, IOC and unlimited funding."""

import hashlib
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from virtual_exchange.api import create_app
from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.types import AuthenticatedIdentity, Instrument, Permission

D = Decimal
INSTRUMENT = Instrument("ABC-USD", "ABC", "USD", D("0.01"), D("0.1"))
ACCOUNTS = ("alice", "bob", "carol")


def identity(account="alice"):
    return AuthenticatedIdentity(account, frozenset(Permission))


def make_exchange(allocations=None, **options):
    return Exchange(
        instrument=INSTRUMENT,
        allocations=allocations
        or {"alice": (D(1000), D(0)), "bob": (D(0), D(10)), "carol": (D(0), D(0))},
        **options,
    )


@pytest.fixture
def exchange():
    return make_exchange()


@pytest.fixture
def api(exchange):
    auth = Authenticator(
        credentials={
            hashlib.sha256(account.encode()).hexdigest(): identity(account)
            for account in ACCOUNTS
        }
    )
    with TestClient(create_app(authenticator=auth, exchange=exchange)) as client:
        yield client


def post(api, side, owner, price="100", quantity="2", **extra):
    return api.post(
        "/orders",
        headers={"Authorization": "Bearer " + owner},
        json={
            "instrument_id": "ABC-USD",
            "side": side,
            "price": price,
            "quantity": quantity,
            **extra,
        },
    )


def subscribe(socket, channels, token=None):
    message = {"type": "subscribe", "channels": channels}
    if token is not None:
        message["token"] = token
    socket.send_json(message)
    assert socket.receive_json()["type"] == "subscribed"
    if "book" in channels:
        for _ in range(3):
            socket.receive_json()


def balances(api, owner):
    data = api.get("/balances", headers={"Authorization": "Bearer " + owner}).json()
    return {b["asset_id"]: (b["available"], b["reserved"]) for b in data["data"]}


# Public trade side is the maker order's side (criterion 4).


@pytest.mark.parametrize(
    ("maker", "maker_side", "taker", "taker_side"),
    [("bob", "sell", "alice", "buy"), ("alice", "buy", "bob", "sell")],
)
def test_public_trade_side_is_maker_side_over_rest_and_websocket(
    api, maker, maker_side, taker, taker_side
):
    resting = post(api, maker_side, maker).json()
    with api.websocket_connect("/ws") as socket:
        subscribe(socket, ["trades"])
        post(api, taker_side, taker)
        (streamed,) = socket.receive_json()["payload"]
    (listed,) = api.get("/trades").json()["data"]
    for trade in (streamed, listed):
        assert trade["maker_order_id"] == resting["order_id"]
        assert trade["side"] == maker_side
    fills = api.get("/fills", headers={"Authorization": "Bearer " + taker}).json()
    (fill,) = fills["data"]
    assert (fill["side"], fill["liquidity"]) == (taker_side, "taker")
