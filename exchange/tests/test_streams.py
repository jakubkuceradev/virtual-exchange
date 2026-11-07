"""Verify stream ordering, privacy, committed state and bounded delivery."""

import asyncio
import hashlib
import json
import logging
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from virtual_exchange.api import create_app
from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange, observations
from virtual_exchange.types import (
    AuthenticatedIdentity,
    Instrument,
    LimitOrder,
    OrderSide,
    Permission,
)

D = Decimal


@pytest.fixture
def anyio_backend():
    return "asyncio"


def identity(account="alice", grants=tuple(Permission)):
    return AuthenticatedIdentity(account, frozenset(grants))


@pytest.fixture
def exchange():
    return Exchange(
        instrument=Instrument("ABC-USD", "ABC", "USD", D("0.01"), D("0.1")),
        allocations={"alice": (D(1000), D(3)), "bob": (D(0), D(10))},
    )


@pytest.fixture
def api(exchange):
    auth = Authenticator(
        credentials={
            hashlib.sha256(token.encode()).hexdigest(): owner
            for token, owner in [
                ("alice", identity()),
                ("bob", identity("bob")),
                ("trade-only", identity(grants=(Permission.TRADE,))),
            ]
        }
    )
    with TestClient(create_app(authenticator=auth, exchange=exchange)) as client:
        yield client


def post(api, side="buy", owner="alice", price="100", quantity="2"):
    return api.post(
        "/orders",
        headers={"Authorization": "Bearer " + owner},
        json={
            "instrument_id": "ABC-USD",
            "side": side,
            "price": price,
            "quantity": quantity,
        },
    )


def subscribe(socket, channels, token=None):
    message = {"type": "subscribe", "channels": channels}
    if token is not None:
        message["token"] = token
    socket.send_json(message)
    control = socket.receive_json()
    assert control["type"] == "subscribed"
    book = []
    if "book" in channels:
        book = [socket.receive_json() for _ in range(3)]
        assert [m["type"] for m in book] == [
            "snapshot_start",
            "snapshot",
            "snapshot_end",
        ]
    return control, book


def test_websocket_events_describe_settled_trade(api):
    sell = post(api, "sell", "bob").json()
    with api.websocket_connect("/ws") as socket:
        control, initial = subscribe(
            socket, ["book", "trades", "orders", "fills"], "alice"
        )
        assert initial[1]["payload"]["asks"] == [{"price": "100.00", "quantity": "2.0"}]
        buy = post(api).json()
        messages = [socket.receive_json() for _ in range(4)]
        assert [m["channel"] for m in messages] == ["book", "trades", "orders", "fills"]
        assert messages[0]["payload"] == [
            {"side": "sell", "price": "100.00", "quantity": "0"}
        ]
        trade = messages[1]["payload"][0]
        assert trade["maker_order_id"] == sell["order_id"]
        assert trade["taker_order_id"] == buy["order_id"]
        assert "account_id" not in trade
        assert {o["account_id"] for o in messages[2]["payload"]} == {"alice"}
        assert messages[3]["payload"][0]["order_id"] == buy["order_id"]
        snapshot = api.get(
            "/account/snapshot", headers={"Authorization": "Bearer alice"}
        ).json()
        assert snapshot["commit_id"] == messages[0]["commit_id"]
        assert {b["asset_id"]: D(b["available"]) for b in snapshot["balances"]} == {
            "USD": D(800),
            "ABC": D(5),
        }
        for event in messages:
            assert (
                event["sequence"]
                == control["payload"]["channels"][event["channel"]] + 1
            )


@pytest.mark.parametrize(
    "subscription_request",
    [
        {"type": "subscribe", "channels": ["orders"]},
        {"type": "subscribe", "channels": ["fills"], "token": "trade-only"},
        {"type": "subscribe", "channels": ["book"], "token": "unknown-secret"},
        {
            "type": "subscribe",
            "channels": ["orders"],
            "token": "alice",
            "account_id": "bob",
        },
        {"type": "order", "channels": ["book"]},
        {"type": "subscribe", "channels": []},
        {"type": "subscribe", "channels": ["book", "book"]},
    ],
)
def test_bad_subscriptions_close_without_secret_echo(api, subscription_request, caplog):
    with api.websocket_connect("/ws") as socket:
        caplog.set_level(logging.DEBUG)
        socket.send_json(subscription_request)
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1008
        assert not error.value.reason
        assert "unknown-secret" not in caplog.text


def test_no_url_tokens_resubscription_or_websocket_trading(api):
    with api.websocket_connect("/ws?token=synthetic") as socket:
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1008
    with api.websocket_connect("/ws") as socket:
        subscribe(socket, ["trades"])
        socket.send_json({"type": "submit", "side": "buy"})
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1008


def test_oversized_incoming_message(api):
    with api.websocket_connect("/ws") as socket:
        socket.send_text("x" * (observations.MAX_INCOMING + 1))
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1009


def test_slow_subscriber_closes_without_undoing_trade(api, monkeypatch):
    original = Exchange.subscribe

    async def bounded(self, **kwargs):
        sub = await original(self, **kwargs)
        sub.max_messages = 0
        return sub

    monkeypatch.setattr(Exchange, "subscribe", bounded)
    with api.websocket_connect("/ws") as socket:
        subscribe(socket, ["book"])
        assert post(api).status_code == 201
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1013
    assert len(api.get("/book").json()["data"]["bids"]) == 1


@pytest.mark.anyio
async def test_concurrent_subscription_never_misses_book_change(exchange):
    # Hold the same gate, then enqueue subscription and command in both orders.
    for subscribe_first in (True, False):
        ex = Exchange(
            instrument=exchange.amounts.instrument,
            allocations={"alice": (D(1000), D(0))},
        )
        await ex._lock.acquire()

        async def command(ex=ex):
            return await ex.submit_order(
                identity=identity(),
                order=LimitOrder("ABC-USD", OrderSide.BUY, D(100), D(2)),
            )

        operations = [lambda ex=ex: ex.subscribe(channels=frozenset({"book"})), command]
        if not subscribe_first:
            operations.reverse()
        tasks = [asyncio.create_task(operation()) for operation in operations]
        await asyncio.sleep(0)
        ex._lock.release()
        results = await asyncio.gather(*tasks)
        sub = results[0 if subscribe_first else 1]
        snapshot = json.loads(sub.initial[2])
        if subscribe_first:
            assert not snapshot["payload"]["bids"]
            update = json.loads(await sub.receive())
            assert update["payload"] == [
                {"side": "buy", "price": "100.00", "quantity": "2.0"}
            ]
            assert update["sequence"] == snapshot["sequence"] + 1
        else:
            assert snapshot["payload"]["bids"]
            assert sub.queue.empty()
        await ex.unsubscribe(sub)


@pytest.mark.anyio
async def test_private_isolation_prevention_and_healthy_consumer(exchange):
    alice = await exchange.subscribe(
        channels=frozenset({"orders", "fills"}), identity=identity()
    )
    bob = await exchange.subscribe(
        channels=frozenset({"orders", "fills"}), identity=identity("bob")
    )
    slow = await exchange.subscribe(channels=frozenset({"book"}))
    slow.max_bytes = 0
    await exchange.submit_order(
        identity=identity(), order=LimitOrder("ABC-USD", OrderSide.SELL, D(100), D(3))
    )
    assert slow.failed.is_set() and bob.queue.empty()
    await alice.receive()
    receipt = await exchange.submit_order(
        identity=identity(), order=LimitOrder("ABC-USD", OrderSide.BUY, D(100), D(5))
    )
    update = json.loads(await alice.receive())
    assert {o["prevented_quantity"] for o in update["payload"]} == {"3.0"}
    assert len(update["payload"]) == 2
    assert alice.queue.empty() and bob.queue.empty()
    assert not (await exchange.list_trades())["data"]
    snapshot = await exchange.get_account_snapshot(identity=identity())
    assert dict(snapshot.channel_baselines) == {"orders": 2, "fills": 0}
    assert next(
        o for o in snapshot.orders if o.order_id == receipt.order_id
    ).remaining_quantity == D(2)


@pytest.mark.anyio
async def test_encoding_failure_before_commit_publishes_nothing(exchange, monkeypatch):
    subscription = await exchange.subscribe(
        channels=frozenset({"orders"}), identity=identity()
    )
    before = await exchange.get_account_snapshot(identity=identity())
    original = exchange._prepare_observations

    def fail(candidate):
        original(candidate)
        raise RuntimeError("injected encoding failure")

    monkeypatch.setattr(exchange, "_prepare_observations", fail)
    with pytest.raises(RuntimeError):
        await exchange.submit_order(
            identity=identity(),
            order=LimitOrder("ABC-USD", OrderSide.BUY, D(100), D(2)),
        )
    assert await exchange.get_account_snapshot(identity=identity()) == before
    assert subscription.queue.empty()


def test_reconnect_and_rest_reconciliation(api):
    with api.websocket_connect("/ws") as socket:
        subscribe(socket, ["book", "orders", "fills"], "alice")
        first = post(api).json()
        assert socket.receive_json()["channel"] == "book"
        assert socket.receive_json()["channel"] == "orders"
    post(api, "sell", "bob")
    with api.websocket_connect("/ws") as socket:
        control, snapshot = subscribe(socket, ["book", "orders", "fills"], "alice")
        assert snapshot[1]["payload"] == {"bids": [], "asks": []}
        account = api.get(
            "/account/snapshot", headers={"Authorization": "Bearer alice"}
        ).json()
        assert account["orders"][0]["order_id"] == first["order_id"]
        assert account["orders"][0]["status"] == "filled"
        fills = api.get(
            "/fills",
            params={"high_watermark": account["fill_high_watermark"]},
            headers={"Authorization": "Bearer alice"},
        ).json()
        assert len(fills["data"]) == 1
        assert (
            dict(account["channel_baselines"])["fills"]
            == control["payload"]["channels"]["fills"]
        )


def test_fragmented_bundles_reassemble_with_one_sequence():
    payload = [{"price": str(i), "quantity": "1"} for i in range(1000)]
    messages = observations.frames(
        process_id="process",
        channel="book",
        sequence=4,
        commit_id=7,
        kind="update",
        payload=payload,
        max_bytes=1024,
    )
    decoded = [json.loads(message) for message in messages]
    assert len(decoded) > 1
    assert all(len(message.encode()) <= 1024 for message in messages)
    assert {m["sequence"] for m in decoded} == {4}
    assert [m["part"] for m in decoded] == list(range(1, len(decoded) + 1))
    assert json.loads("".join(m["payload_fragment"] for m in decoded)) == payload


def test_heartbeat_and_subscription_timeout(api, monkeypatch):
    monkeypatch.setattr(observations, "HEARTBEAT_SECONDS", 0.01)
    with api.websocket_connect("/ws") as socket:
        subscribe(socket, ["trades"])
        assert socket.receive_json()["type"] == "heartbeat"
    monkeypatch.setattr(observations, "SUBSCRIBE_TIMEOUT", 0.01)
    with api.websocket_connect("/ws") as socket:
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1008


@pytest.mark.anyio
async def test_restart_invalidates_cursors_and_stream_baselines(exchange):
    for _ in range(2):
        await exchange.submit_order(
            identity=identity(),
            order=LimitOrder("ABC-USD", OrderSide.BUY, D(100), D(1)),
        )
    page = await exchange.list_orders(identity=identity(), limit=1)
    fresh = Exchange(
        instrument=exchange.amounts.instrument, allocations={"alice": (D(1000), D(3))}
    )
    from virtual_exchange.exchange.service import TradingError

    with pytest.raises(TradingError):
        await fresh.list_orders(identity=identity(), cursor=page["next_cursor"])
    subscription = await fresh.subscribe(
        channels=frozenset({"book", "orders"}), identity=identity()
    )
    control = json.loads(subscription.initial[0])
    assert control["process_id"] != exchange.process_id
    assert control["payload"]["channels"] == {"book": 0, "orders": 0}


def test_send_timeout_and_disconnect_cleanup(api, exchange, monkeypatch):
    from starlette.websockets import WebSocket

    original = WebSocket.send_text

    async def slow_send(self, data):
        await asyncio.sleep(0.05)
        await original(self, data)

    monkeypatch.setattr(WebSocket, "send_text", slow_send)
    monkeypatch.setattr(observations, "SEND_TIMEOUT", 0.001)
    with api.websocket_connect("/ws") as socket:
        socket.send_json({"type": "subscribe", "channels": ["book"]})
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1013
    assert not exchange._subscribers


@pytest.mark.anyio
async def test_multi_fill_bundles_preserve_execution_order(exchange):
    for size, price in (("4", "99"), ("5", "100")):
        await exchange.submit_order(
            identity=identity("bob"),
            order=LimitOrder("ABC-USD", OrderSide.SELL, D(price), D(size)),
        )
    sub = await exchange.subscribe(
        channels=frozenset({"trades", "fills"}), identity=identity()
    )
    await exchange.submit_order(
        identity=identity(), order=LimitOrder("ABC-USD", OrderSide.BUY, D(100), D(10))
    )
    trades = json.loads(await sub.receive())
    fills = json.loads(await sub.receive())
    assert [D(t["quantity"]) for t in trades["payload"]] == [D(4), D(5)]
    assert [D(t["price"]) for t in trades["payload"]] == [D(99), D(100)]
    assert [
        t["execution_id"] if "execution_id" in t else t["trade_id"]
        for t in trades["payload"]
    ] == [f["trade_id"] for f in fills["payload"]]
    assert trades["commit_id"] == fills["commit_id"]


@pytest.mark.anyio
async def test_read_started_during_reservation_sees_only_final_state(
    exchange, monkeypatch
):
    from virtual_exchange.exchange.ledger import Ledger

    await exchange.submit_order(
        identity=identity("bob"),
        order=LimitOrder("ABC-USD", OrderSide.SELL, D(100), D(2)),
    )
    readers = []
    original = Ledger.reserve

    def observe(*args, **kwargs):
        original(*args, **kwargs)
        readers.append(
            asyncio.create_task(exchange.get_account_snapshot(identity=identity()))
        )

    monkeypatch.setattr(Ledger, "reserve", observe)
    await exchange.submit_order(
        identity=identity(), order=LimitOrder("ABC-USD", OrderSide.BUY, D(100), D(2))
    )
    snapshot = await readers[0]
    assert {b.asset_id: (b.available, b.reserved) for b in snapshot.balances} == {
        "USD": (D(800), D(0)),
        "ABC": (D(5), D(0)),
    }
    assert snapshot.orders[0].status == "filled"
