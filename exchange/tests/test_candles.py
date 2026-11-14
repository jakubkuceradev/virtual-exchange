"""Verify recent one-minute candles: buckets, window, endpoint, and restart."""

import hashlib
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from virtual_exchange.api import create_app
from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.candles import CAPACITY, CandleSeries
from virtual_exchange.exchange.store import Store
from virtual_exchange.types import (
    AuthenticatedIdentity,
    Instrument,
    LimitOrder,
    OrderSide,
    Permission,
    Trade,
)

D = Decimal
BASE = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
INSTRUMENT = Instrument("ABC-USD", "ABC", "USD", D("0.01"), D("0.1"))
ALLOCATIONS = {"alice": (D(10_000), D(0)), "bob": (D(0), D(100))}


def trade(number: int, price: str, quantity: str, at: datetime) -> Trade:
    return Trade(
        str(number), "ABC-USD", D(price), D(quantity), at, "m", "t", OrderSide.SELL
    )


def test_buckets_hold_ohlc_and_volume_of_actual_executions():
    series = CandleSeries()
    series.add(trade(1, "100", "1", BASE + timedelta(seconds=5)))
    series.add(trade(2, "102", "2", BASE + timedelta(seconds=40)))
    series.add(trade(3, "101", "1", BASE + timedelta(seconds=50)))
    series.add(trade(4, "98", "0.5", BASE + timedelta(minutes=3, seconds=10)))
    candles = series.candles()
    assert [(c.start, c.open, c.high, c.low, c.close, c.volume) for c in candles] == [
        (BASE, D(100), D(102), D(100), D(101), D(4)),
        (BASE + timedelta(minutes=3), D(98), D(98), D(98), D(98), D("0.5")),
    ]
    assert series.through_trade_id == "4"


def test_only_the_last_capacity_minutes_are_kept_and_ranges_filter():
    series = CandleSeries()
    for minute in range(CAPACITY + 10):
        series.add(trade(minute + 1, "100", "1", BASE + timedelta(minutes=minute)))
    candles = series.candles()
    assert len(candles) == CAPACITY
    assert candles[0].start == BASE + timedelta(minutes=10)
    recent = series.candles(start=BASE + timedelta(minutes=CAPACITY + 5))
    assert [c.start for c in recent] == [
        BASE + timedelta(minutes=CAPACITY + offset) for offset in range(5, 10)
    ]
    assert series.candles(end=BASE + timedelta(minutes=11))[-1].start == (
        BASE + timedelta(minutes=10)
    )


def test_a_clock_step_backwards_folds_into_the_newest_bucket():
    series = CandleSeries()
    series.add(trade(1, "100", "1", BASE + timedelta(minutes=5)))
    series.add(trade(2, "99", "1", BASE + timedelta(minutes=4, seconds=59)))
    (only,) = series.candles()
    assert (only.low, only.close, only.volume) == (D(99), D(99), D(2))


@pytest.fixture
def api():
    exchange = Exchange(instrument=INSTRUMENT, allocations=ALLOCATIONS)
    auth = Authenticator(
        credentials={
            hashlib.sha256(account.encode()).hexdigest(): AuthenticatedIdentity(
                account, frozenset(Permission)
            )
            for account in ALLOCATIONS
        }
    )
    with TestClient(create_app(authenticator=auth, exchange=exchange)) as client:
        yield client


def cross(api, price="100", quantity="2"):
    for account, side in (("bob", "sell"), ("alice", "buy")):
        response = api.post(
            "/orders",
            headers={"Authorization": f"Bearer {account}"},
            json={
                "instrument_id": "ABC-USD",
                "side": side,
                "price": price,
                "quantity": quantity,
            },
        )
        assert response.status_code == 201


def test_endpoint_serves_public_candles_and_the_trade_they_include(api):
    empty = api.get("/candles").json()
    assert empty["data"] == [] and empty["through_trade_id"] is None
    cross(api, "100", "2")
    cross(api, "101", "1")
    body = api.get("/candles", params={"granularity": 60}).json()
    assert body["granularity"] == 60
    assert body["through_trade_id"] == "2"
    assert body["commit_id"] == api.get("/book").json()["commit_id"]
    assert set(body) == {
        "process_id",
        "commit_id",
        "granularity",
        "through_trade_id",
        "data",
    }
    last = body["data"][-1]
    assert [D(last[k]) for k in ("high", "low", "close")] == [D(101), D(100), D(101)]
    assert sum(D(c["volume"]) for c in body["data"]) == D(3)
    assert body["data"][-1]["start"].endswith(":00+00:00")


def test_endpoint_rejects_unsupported_or_invalid_requests(api):
    assert api.get("/candles?granularity=300").json() == {
        "error": "unsupported_granularity"
    }
    naive = api.get("/candles", params={"start": "2026-11-07T12:00:00"})
    assert (naive.status_code, naive.json()) == (400, {"error": "invalid_request"})
    backwards = api.get(
        "/candles",
        params={"start": "2026-11-07T13:00:00Z", "end": "2026-11-07T12:00:00Z"},
    )
    assert backwards.status_code == 400
    assert api.get("/candles?granularity=x").json() == {"error": "invalid_request"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_restart_rebuilds_the_same_candles_from_the_store(tmp_path):
    Store.create(tmp_path)

    def reopen():
        return Exchange(
            instrument=INSTRUMENT, allocations=ALLOCATIONS, store=Store.open(tmp_path)
        )

    def identity(account):
        return AuthenticatedIdentity(account, frozenset(Permission))

    exchange = reopen()
    for price in ("100", "103", "99"):
        await exchange.submit_order(
            identity=identity("bob"),
            order=LimitOrder("ABC-USD", OrderSide.SELL, D(price), D("1")),
        )
        await exchange.submit_order(
            identity=identity("alice"),
            order=LimitOrder("ABC-USD", OrderSide.BUY, D(price), D("1")),
        )
    before = await exchange.get_candles()
    exchange.close()
    exchange = reopen()
    after = await exchange.get_candles()
    exchange.close()
    assert after["data"] == before["data"]
    assert after["through_trade_id"] == before["through_trade_id"] == "3"


def test_store_finds_recent_trades_by_time(tmp_path):
    Store.create(tmp_path)
    store = Store.open(tmp_path)
    store.adopt(INSTRUMENT, {})
    assert store.latest_trade() is None
    assert store.trades_since(BASE) == ()
    for number in range(1, 101):
        store.commit(
            commit_id=number,
            new_order_id=None,
            orders=(),
            fills={},
            trades=(trade(number, "100", "1", BASE + timedelta(minutes=number)),),
            balances={},
            at=0.0,
        )
    assert store.latest_trade().trade_id == "100"
    found = store.trades_since(BASE + timedelta(minutes=37))
    assert [t.trade_id for t in found] == [str(n) for n in range(37, 101)]
    assert store.trades_since(BASE + timedelta(minutes=36, seconds=30))[0].trade_id == (
        "37"
    )
    assert store.trades_since(BASE + timedelta(days=1)) == ()
    assert len(store.trades_since(BASE - timedelta(days=1))) == 100
    store.close()
