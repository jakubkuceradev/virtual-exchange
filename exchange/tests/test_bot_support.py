"""Verify features automated traders need: maker side, IOC and unlimited funding."""

import hashlib
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from virtual_exchange.api import create_app
from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.ledger import InsufficientFunds
from virtual_exchange.types import (
    AuthenticatedIdentity,
    Instrument,
    LimitOrder,
    OrderSide,
    OrderStatus,
    Permission,
    TimeInForce,
)

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
def anyio_backend():
    return "asyncio"


def limit(side, quantity, price, tif=TimeInForce.GTC):
    return LimitOrder("ABC-USD", OrderSide(side), D(price), D(quantity), None, tif)


async def submit(exchange, owner, side, quantity, price, tif=TimeInForce.GTC):
    receipt = await exchange.submit_order(
        identity=identity(owner), order=limit(side, quantity, price, tif)
    )
    return await exchange.get_order(identity=identity(owner), order_id=receipt.order_id)


async def holdings(exchange, owner):
    result = await exchange.get_balances(identity=identity(owner))
    return {b.asset_id: (b.available, b.reserved) for b in result}


async def totals(exchange):
    cash = asset = D(0)
    for owner in ACCOUNTS:
        held = await holdings(exchange, owner)
        cash += sum(held["USD"])
        asset += sum(held["ABC"])
    return cash, asset


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


# Immediate-or-cancel orders (criteria 1-3).


@pytest.mark.anyio
async def test_ioc_fills_crossing_liquidity_and_cancels_the_rest(exchange):
    before = await totals(exchange)
    await submit(exchange, "bob", "sell", "4", "99")
    await submit(exchange, "bob", "sell", "3", "100")
    order = await submit(exchange, "alice", "buy", "10", "100", TimeInForce.IOC)
    assert order.status == OrderStatus.CANCELLED
    assert order.time_in_force == TimeInForce.IOC
    assert (
        order.filled_quantity,
        order.cancelled_quantity,
        order.remaining_quantity,
    ) == (D(7), D(3), D(0))
    trades = (await exchange.list_trades())["data"]
    assert [(t.price, t.quantity) for t in reversed(trades)] == [
        (D(99), D(4)),
        (D(100), D(3)),
    ]
    book = await exchange.get_order_book()
    assert book.bids == book.asks == ()
    # 4 * 99 + 3 * 100 = 696 settled; nothing stays reserved.
    assert await holdings(exchange, "alice") == {
        "USD": (D(304), D(0)),
        "ABC": (D(7), D(0)),
    }
    assert await totals(exchange) == before


@pytest.mark.anyio
async def test_ioc_fully_filled_is_filled(exchange):
    await submit(exchange, "bob", "sell", "5", "100")
    order = await submit(exchange, "alice", "buy", "5", "101", TimeInForce.IOC)
    assert order.status == OrderStatus.FILLED
    assert order.cancelled_quantity == 0
    assert (await holdings(exchange, "alice"))["USD"] == (D(500), D(0))


@pytest.mark.anyio
async def test_ioc_without_crossing_liquidity_is_accepted_and_cancelled(exchange):
    await submit(exchange, "bob", "sell", "2", "101")
    before = await exchange.get_order_book()
    order = await submit(exchange, "alice", "buy", "2", "100", TimeInForce.IOC)
    assert order.status == OrderStatus.CANCELLED
    assert (order.filled_quantity, order.cancelled_quantity) == (D(0), D(2))
    after = await exchange.get_order_book()
    assert (after.bids, after.asks) == (before.bids, before.asks)
    assert await holdings(exchange, "alice") == {
        "USD": (D(1000), D(0)),
        "ABC": (D(0), D(0)),
    }
    assert not (await exchange.list_trades())["data"]


@pytest.mark.anyio
async def test_ioc_applies_self_trade_prevention():
    exchange = make_exchange(
        {"alice": (D(1000), D(2)), "bob": (D(0), D(10)), "carol": (D(0), D(0))}
    )
    own = await submit(exchange, "alice", "sell", "2", "100")
    await submit(exchange, "bob", "sell", "2", "100")
    order = await submit(exchange, "alice", "buy", "5", "100", TimeInForce.IOC)
    assert (
        order.filled_quantity,
        order.prevented_quantity,
        order.cancelled_quantity,
    ) == (D(2), D(2), D(1))
    assert order.status == OrderStatus.CANCELLED
    own = await exchange.get_order(identity=identity(), order_id=own.order_id)
    assert (own.status, own.prevented_quantity) == (OrderStatus.CANCELLED, D(2))
    assert await holdings(exchange, "alice") == {
        "USD": (D(800), D(0)),
        "ABC": (D(4), D(0)),
    }


@pytest.mark.anyio
async def test_funded_ioc_still_needs_the_full_hold(exchange):
    await submit(exchange, "bob", "sell", "1", "100")
    with pytest.raises(InsufficientFunds):
        await submit(exchange, "carol", "buy", "1", "100", TimeInForce.IOC)
    assert len((await exchange.get_order_book()).asks) == 1


def test_rest_time_in_force_parsing_and_observation(api):
    resting = post(api, "buy", "alice", time_in_force="GTC")
    default = post(api, "buy", "alice", price="99")
    for receipt in (resting, default):
        order = api.get(
            "/orders/" + receipt.json()["order_id"],
            headers={"Authorization": "Bearer alice"},
        ).json()["data"]
        assert (order["time_in_force"], order["status"]) == ("GTC", "open")
    for value in ("ioc", "FOK", "GTT", 1, None):
        response = post(api, "buy", "alice", time_in_force=value)
        assert response.status_code == 400
        assert response.json() == {"error": "invalid_request"}
    ioc = post(api, "sell", "bob", quantity="5", time_in_force="IOC")
    assert ioc.status_code == 201
    order = api.get(
        "/orders/" + ioc.json()["order_id"], headers={"Authorization": "Bearer bob"}
    ).json()["data"]
    assert order["status"] == "cancelled"
    assert (order["filled_quantity"], order["cancelled_quantity"]) == ("2.0", "3.0")
    assert api.get("/book").json()["data"]["asks"] == []
    assert balances(api, "bob") == {
        "USD": ("200.000", "0.000"),
        "ABC": ("8.0", "0.0"),
    }


def test_websocket_observers_never_see_the_ioc_remainder(api):
    post(api, "sell", "bob", quantity="1")
    with api.websocket_connect("/ws") as socket:
        subscribe(socket, ["book", "trades", "orders", "fills"], "alice")
        post(api, "buy", "alice", quantity="3", time_in_force="IOC")
        messages = [socket.receive_json() for _ in range(4)]
        assert [m["channel"] for m in messages] == ["book", "trades", "orders", "fills"]
        assert messages[0]["payload"] == [
            {"side": "sell", "price": "100.00", "quantity": "0.0"}
        ]
        (order,) = messages[2]["payload"]
        assert (order["status"], order["cancelled_quantity"]) == ("cancelled", "2.0")
        # An IOC with nothing to match publishes only its final private state.
        post(api, "buy", "alice", time_in_force="IOC")
        (update,) = socket.receive_json()["payload"]
        assert update["status"] == "cancelled"
        post(api, "buy", "alice", price="90", quantity="1")
        book = socket.receive_json()
        assert book["channel"] == "book"
        assert book["payload"] == [{"side": "buy", "price": "90.00", "quantity": "1.0"}]
