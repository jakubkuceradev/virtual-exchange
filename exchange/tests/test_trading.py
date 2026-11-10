"""Exercise funded operations and isolation using the real matching engine."""

import asyncio
import json
from decimal import Decimal, localcontext
from uuid import uuid4

import pytest

from virtual_exchange.auth import PermissionDenied
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.configuration import TradingConfigurationError
from virtual_exchange.exchange.ledger import InsufficientFunds, Ledger
from virtual_exchange.exchange.matching import MatchingEngine
from virtual_exchange.exchange.service import TradingError
from virtual_exchange.exchange.store import Store
from virtual_exchange.types import (
    AuthenticatedIdentity,
    Instrument,
    LimitOrder,
    Liquidity,
    OrderSide,
    Permission,
)

D = Decimal
INSTRUMENT = Instrument("ABC-USD", "ABC", "USD", D("0.01"), D("0.1"))


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def exchange():
    return Exchange(
        instrument=INSTRUMENT,
        allocations={"alice": (D("1000"), D("3")), "bob": (D("0"), D("10"))},
    )


def identity(account="alice", grants=(Permission.READ, Permission.TRADE)):
    return AuthenticatedIdentity(account, frozenset(grants))


def order(side, quantity="2", price="100", client=None):
    return LimitOrder("ABC-USD", side, D(price), D(quantity), client)


async def balances(exchange, account="alice"):
    result = await exchange.get_balances(identity=identity(account))
    return {b.asset_id: (b.available, b.reserved) for b in result}


@pytest.mark.anyio
async def test_basic_trade():
    exchange = Exchange(
        instrument=INSTRUMENT,
        allocations={"alice": (D("1000"), D(0)), "bob": (D(0), D("10"))},
    )
    sell = await exchange.submit_order(
        identity=identity("bob"), order=order(OrderSide.SELL)
    )
    buy = await exchange.submit_order(identity=identity(), order=order(OrderSide.BUY))
    assert await balances(exchange) == {"USD": (D(800), D(0)), "ABC": (D(2), D(0))}
    assert await balances(exchange, "bob") == {
        "USD": (D(200), D(0)),
        "ABC": (D(8), D(0)),
    }
    for receipt in (sell, buy):
        account = "bob" if receipt == sell else "alice"
        assert (
            await exchange.get_order(
                identity=identity(account), order_id=receipt.order_id
            )
        ).status == "filled"
    (taker,) = (await exchange.list_fills(identity=identity()))["data"]
    (maker,) = (await exchange.list_fills(identity=identity("bob")))["data"]
    assert (maker.order_id, maker.liquidity) == (sell.order_id, Liquidity.MAKER)
    assert (taker.order_id, taker.liquidity) == (buy.order_id, Liquidity.TAKER)
    assert maker.trade_id == taker.trade_id
    trades = await exchange.list_trades()
    assert len(trades["data"]) == 1
    assert trades["data"][0].maker_order_id == sell.order_id


@pytest.mark.anyio
async def test_savings_partial_fill_and_cancellation(exchange):
    await exchange.submit_order(
        identity=identity("bob"), order=order(OrderSide.SELL, "4", "99")
    )
    receipt = await exchange.submit_order(
        identity=identity(), order=order(OrderSide.BUY, "10")
    )
    assert await balances(exchange) == {"USD": (D(4), D(600)), "ABC": (D(7), D(0))}
    await exchange.cancel_order(identity=identity(), order_id=receipt.order_id)
    assert (await balances(exchange))["USD"] == (D(604), D(0))
    assert len((await exchange.list_trades())["data"]) == 1


@pytest.mark.anyio
async def test_inventory_reservation_and_release(exchange):
    first = await exchange.submit_order(
        identity=identity("bob"), order=order(OrderSide.SELL, "10")
    )
    before = await exchange.get_account_snapshot(identity=identity("bob"))
    with pytest.raises(InsufficientFunds):
        await exchange.submit_order(
            identity=identity("bob"), order=order(OrderSide.SELL, "1")
        )
    assert await exchange.get_account_snapshot(identity=identity("bob")) == before
    await exchange.cancel_order(identity=identity("bob"), order_id=first.order_id)
    assert (await balances(exchange, "bob"))["ABC"] == (D(10), D(0))


@pytest.mark.anyio
async def test_concurrent_orders_cannot_overspend(exchange):
    results = await asyncio.gather(
        *(
            exchange.submit_order(identity=identity(), order=order(OrderSide.BUY, "7"))
            for _ in range(2)
        ),
        return_exceptions=True,
    )
    assert sum(isinstance(r, InsufficientFunds) for r in results) == 1
    assert (await balances(exchange))["USD"] == (D(300), D(700))
    assert len((await exchange.list_orders(identity=identity()))["data"]) == 1


@pytest.mark.anyio
@pytest.mark.parametrize("sell,buy", [("3", "5"), ("3", "2"), ("3", "3")])
async def test_self_trade_releases_both_holds(exchange, sell, buy):
    await exchange.submit_order(identity=identity(), order=order(OrderSide.SELL, sell))
    await exchange.submit_order(identity=identity(), order=order(OrderSide.BUY, buy))
    remaining_cash = max(D(buy) - D(sell), D(0)) * 100
    remaining_asset = max(D(sell) - D(buy), D(0))
    assert await balances(exchange) == {
        "USD": (D(1000) - remaining_cash, remaining_cash),
        "ABC": (D(3) - remaining_asset, remaining_asset),
    }
    assert not (await exchange.list_trades())["data"]
    assert not (await exchange.list_fills(identity=identity()))["data"]


@pytest.mark.anyio
async def test_partial_fill_then_prevention_conserves_assets(exchange):
    await exchange.submit_order(
        identity=identity("bob"), order=order(OrderSide.SELL, "1", "99")
    )
    await exchange.submit_order(identity=identity(), order=order(OrderSide.SELL, "3"))
    await exchange.submit_order(identity=identity(), order=order(OrderSide.BUY, "5"))
    assert await balances(exchange) == {"USD": (D(801), D(100)), "ABC": (D(4), D(0))}
    assert await balances(exchange, "bob") == {
        "USD": (D(99), D(0)),
        "ABC": (D(9), D(0)),
    }
    totals = [await balances(exchange, a) for a in ("alice", "bob")]
    assert sum(sum(b["USD"]) for b in totals) == D(1000)
    assert sum(sum(b["ABC"]) for b in totals) == D(13)


@pytest.mark.anyio
@pytest.mark.parametrize(
    "target,method",
    [
        (Ledger, "reserve"),
        (MatchingEngine, "submit"),
        (Ledger, "settle"),
        (Ledger, "reconcile"),
    ],
)
async def test_precommit_failures_leave_everything_unchanged(
    exchange, monkeypatch, target, method
):
    await exchange.submit_order(identity=identity("bob"), order=order(OrderSide.SELL))
    before = [
        await exchange.get_account_snapshot(identity=identity(a))
        for a in ("alice", "bob")
    ]
    book = await exchange.get_order_book()
    original = getattr(target, method)

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("injected failure")

    monkeypatch.setattr(target, method, fail)
    with pytest.raises(RuntimeError, match="injected failure"):
        await exchange.submit_order(identity=identity(), order=order(OrderSide.BUY))
    assert [
        await exchange.get_account_snapshot(identity=identity(a))
        for a in ("alice", "bob")
    ] == before
    current = await exchange.get_order_book()
    assert (current.bids, current.asks, current.sequence) == (
        book.bids,
        book.asks,
        book.sequence,
    )
    assert not (await exchange.list_trades())["data"]


@pytest.mark.anyio
async def test_grants_ownership_and_terminal_errors(exchange):
    receipt = await exchange.submit_order(
        identity=identity("bob"), order=order(OrderSide.SELL)
    )
    for order_id in (receipt.order_id, "unknown"):
        with pytest.raises(TradingError, match="order_not_found"):
            await exchange.cancel_order(identity=identity(), order_id=order_id)
    with pytest.raises(PermissionDenied):
        await exchange.submit_order(
            identity=identity(grants=(Permission.READ,)), order=order(OrderSide.BUY)
        )
    with pytest.raises(PermissionDenied):
        await exchange.get_balances(identity=identity(grants=(Permission.TRADE,)))
    await exchange.cancel_order(identity=identity("bob"), order_id=receipt.order_id)
    before = await exchange.get_account_snapshot(identity=identity("bob"))
    with pytest.raises(TradingError, match="order_finished"):
        await exchange.cancel_order(identity=identity("bob"), order_id=receipt.order_id)
    assert await exchange.get_account_snapshot(identity=identity("bob")) == before
    with pytest.raises(TradingError, match="account_not_provisioned"):
        await exchange.get_balances(identity=identity("nobody"))


@pytest.mark.anyio
async def test_client_id_deduplication_and_account_scope(exchange):
    client_id = str(uuid4())
    receipt = await exchange.submit_order(
        identity=identity(), order=order(OrderSide.BUY, client=client_id)
    )
    before = await exchange.get_account_snapshot(identity=identity())
    with pytest.raises(TradingError, match="duplicate_client_id"):
        await exchange.submit_order(
            identity=identity(), order=order(OrderSide.BUY, client=client_id)
        )
    assert await exchange.get_account_snapshot(identity=identity()) == before
    assert (
        await exchange.get_order(identity=identity(), order_id="client:" + client_id)
    ).order_id == receipt.order_id
    await exchange.submit_order(
        identity=identity("bob"), order=order(OrderSide.SELL, client=client_id)
    )


@pytest.mark.anyio
async def test_low_decimal_context_and_new_store():
    with localcontext() as context:
        context.prec = 2
        instrument = Instrument("ABC-USD", "ABC", "USD", D("0.05"), D("0.03"))
        allocations = {
            "alice": (D("123456789.123"), D("0")),
            "bob": (D(0), D("123.12")),
        }
        ex = Exchange(instrument=instrument, allocations=allocations)
        await ex.submit_order(
            identity=identity("bob"), order=order(OrderSide.SELL, "123.12", "100.05")
        )
        await ex.submit_order(
            identity=identity(), order=order(OrderSide.BUY, "123.12", "100.10")
        )
        assert (await balances(ex))["USD"] == (D("123444470.967"), D(0))
        fresh = Exchange(instrument=instrument, allocations=allocations)
        assert fresh.process_id != ex.process_id
        assert (await balances(fresh))["USD"] == (D("123456789.123"), D(0))
        assert not (await fresh.list_orders(identity=identity()))["data"]


@pytest.mark.anyio
async def test_pages_fixed_high_watermark_and_cursor_scope(exchange):
    for _ in range(3):
        await exchange.submit_order(
            identity=identity(), order=order(OrderSide.BUY, "1")
        )
    first = await exchange.list_orders(identity=identity(), limit=1)
    await exchange.submit_order(identity=identity(), order=order(OrderSide.BUY, "1"))
    second = await exchange.list_orders(
        identity=identity(), limit=10, cursor=first["next_cursor"]
    )
    assert len(second["data"]) == 2
    assert second["high_watermark"] == 3
    with pytest.raises(TradingError, match="invalid_cursor"):
        await exchange.list_orders(
            identity=identity("bob"), cursor=first["next_cursor"]
        )


@pytest.mark.parametrize(
    "contents",
    [
        "{}",
        '{"version":1,"instrument":{},"accounts":{}}',
        '{"version":1,"version":1}',
        "\ufffd",
    ],
)
def test_invalid_config_is_sanitized(tmp_path, contents):
    path = tmp_path / "trading.json"
    path.write_text(contents)
    with pytest.raises(
        TradingConfigurationError, match="^Invalid trading configuration$"
    ):
        Exchange.from_config(path=path, state_dir=tmp_path)


def test_configuration_allocations(tmp_path):
    path = tmp_path / "trading.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "instrument": {
                    "instrument_id": "ABC-USD",
                    "base_asset": "ABC",
                    "quote_asset": "USD",
                    "price_increment": "0.01",
                    "quantity_increment": "0.1",
                },
                "accounts": {"alice": {"cash": "1000", "asset": "0"}},
            }
        )
    )
    Store.create(tmp_path)
    exchange = Exchange.from_config(path=path, state_dir=tmp_path)
    assert exchange.amounts.instrument == INSTRUMENT
    exchange.close()
    path.write_text(path.read_text().replace('"1000"', '"-1"'))
    with pytest.raises(TradingConfigurationError):
        Exchange.from_config(path=path, state_dir=tmp_path)
