"""Exercise the matching contract without accounts, HTTP, or persistence."""

from dataclasses import FrozenInstanceError, replace
from decimal import Decimal, localcontext

import pytest

from virtual_exchange.exchange.matching import (
    MatchingEngine,
    OrderNotFound,
    OrderRejected,
)
from virtual_exchange.types import (
    BookLevel,
    CancellationReason,
    Instrument,
    OrderSide,
    OrderStatus,
)

D = Decimal
INSTRUMENT = Instrument("ABC-USD", "ABC", "USD", D("0.01"), D("0.1"))


@pytest.fixture
def engine():
    return MatchingEngine(instrument=INSTRUMENT)


def submit(engine, order_id, side, price="100", quantity="2", owner=None):
    return engine.submit(
        order_id=order_id,
        account_id=owner or order_id,
        side=side,
        price=D(price),
        quantity=D(quantity),
    )


def state(engine, *order_ids):
    """Compare state without the observation time of a fresh book read."""
    book = engine.get_order_book()
    return (
        book.bids,
        book.asks,
        book.sequence,
        engine.list_executions(),
        tuple(engine.get_order(order_id=order_id) for order_id in order_ids),
    )


@pytest.mark.parametrize("maker_side", list(OrderSide))
def test_first_vertical_slice(engine, maker_side):
    taker_side = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    original = submit(engine, "maker", maker_side)
    result = submit(engine, "taker", taker_side)
    maker = engine.get_order(order_id="maker")
    assert maker.status == result.order.status == OrderStatus.FILLED
    assert maker.filled_quantity == result.order.filled_quantity == D("2")
    assert original.order.status == OrderStatus.OPEN  # Snapshots do not change.
    assert result.changed_resting_orders == (maker,)
    (execution,) = result.executions
    assert (execution.maker_order_id, execution.taker_order_id) == ("maker", "taker")
    assert (execution.price, execution.quantity) == (D("100"), D("2"))
    assert execution.instrument_id == INSTRUMENT.instrument_id
    assert execution.executed_at.utcoffset().total_seconds() == 0
    assert result.order.accepted_at.utcoffset().total_seconds() == 0
    assert engine.list_executions() == result.executions
    assert not engine.get_order_book().bids
    assert not engine.get_order_book().asks
    with pytest.raises(FrozenInstanceError):
        result.order.quantity = D("3")


@pytest.mark.parametrize(
    ("maker_side", "taker_side", "first_price", "second_price", "limit"),
    [
        (OrderSide.SELL, OrderSide.BUY, "99", "100", "100"),
        (OrderSide.BUY, OrderSide.SELL, "101", "100", "100"),
    ],
)
def test_multilevel_best_price_and_remainder(
    engine, maker_side, taker_side, first_price, second_price, limit
):
    # Worse price arrives first to distinguish price priority from FIFO.
    submit(engine, "second", maker_side, second_price, "5")
    submit(engine, "first", maker_side, first_price, "4")
    submit(
        engine, "outside", maker_side, "102" if taker_side == OrderSide.BUY else "98"
    )
    result = submit(engine, "incoming", taker_side, limit, "10")
    assert [(x.maker_order_id, x.price, x.quantity) for x in result.executions] == [
        ("first", D(first_price), D("4")),
        ("second", D(second_price), D("5")),
    ]
    assert len({x.execution_id for x in result.executions}) == 2
    assert result.order.status == OrderStatus.PARTIALLY_FILLED
    assert result.order.filled_quantity == D("9")
    book = engine.get_order_book()
    resting = book.bids if taker_side == OrderSide.BUY else book.asks
    assert resting == (BookLevel(D(limit), D("1")),)
    executions = engine.list_executions()
    cancelled = engine.cancel(order_id="incoming")
    assert cancelled.order.status == OrderStatus.CANCELLED
    assert cancelled.order.filled_quantity == D("9")
    assert cancelled.cancellation_reason == CancellationReason.REQUESTED
    assert not cancelled.executions
    assert engine.list_executions() == executions
    assert engine.get_order(order_id="outside").status == OrderStatus.OPEN


@pytest.mark.parametrize("maker_side", list(OrderSide))
def test_fifo_survives_partial_fill(engine, maker_side):
    other = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    submit(engine, "earlier", maker_side, quantity="4")
    submit(engine, "later", maker_side, quantity="3")
    first = submit(engine, "take-1", other, quantity="1")
    second = submit(engine, "take-2", other, quantity="4")
    assert [x.maker_order_id for x in first.executions] == ["earlier"]
    assert [(x.maker_order_id, x.quantity) for x in second.executions] == [
        ("earlier", D("3")),
        ("later", D("1")),
    ]
    assert len({x.execution_id for x in engine.list_executions()}) == 3


def test_empty_and_noncrossing_book_aggregation(engine):
    assert state(engine)[:3] == ((), (), 0)
    submit(engine, "b1", OrderSide.BUY, "98", "1")
    submit(engine, "b2", OrderSide.BUY, "99", "2")
    submit(engine, "b3", OrderSide.BUY, "99", "3")
    submit(engine, "s1", OrderSide.SELL, "102", "4")
    submit(engine, "s2", OrderSide.SELL, "101", "5")
    book = engine.get_order_book()
    assert book.bids == (BookLevel(D("99"), D("5")), BookLevel(D("98"), D("1")))
    assert book.asks == (BookLevel(D("101"), D("5")), BookLevel(D("102"), D("4")))
    assert not engine.list_executions()


@pytest.mark.parametrize("maker_side", list(OrderSide))
@pytest.mark.parametrize("earlier_fill", [False, True])
def test_self_trade_cancels_incoming_remainder(engine, maker_side, earlier_fill):
    taker_side = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    if earlier_fill:
        submit(engine, "other", maker_side, quantity="1")
    own = submit(engine, "own", maker_side, owner="alice").order
    submit(engine, "later", maker_side, quantity="1")
    result = submit(engine, "incoming", taker_side, quantity="4", owner="alice")
    assert result.order.status == OrderStatus.CANCELLED
    assert result.order.filled_quantity == D("1" if earlier_fill else "0")
    assert result.cancellation_reason == CancellationReason.SELF_TRADE
    assert [x.maker_order_id for x in result.executions] == (
        ["other"] if earlier_fill else []
    )
    assert engine.get_order(order_id="own") == own
    assert engine.get_order(order_id="later").status == OrderStatus.OPEN
    before = state(engine, "incoming", "own")
    assert engine.cancel(order_id="incoming").cancellation_reason is None
    assert state(engine, "incoming", "own") == before


def test_filled_before_self_order_does_not_cancel(engine):
    submit(engine, "other", OrderSide.SELL, quantity="2")
    submit(engine, "own", OrderSide.SELL, owner="alice")
    result = submit(engine, "incoming", OrderSide.BUY, owner="alice")
    assert result.order.status == OrderStatus.FILLED
    assert result.cancellation_reason is None


@pytest.mark.parametrize(
    "changes",
    [
        {"side": "buy"},
        {"side": "invalid"},
        {"side": None},
        {"price": D("0")},
        {"price": D("-1")},
        {"price": D("NaN")},
        {"price": D("sNaN")},
        {"price": D("Infinity")},
        {"price": D("-Infinity")},
        {"price": D("100.001")},
        {"price": 100.0},
        {"price": "100"},
        {"quantity": D("0")},
        {"quantity": D("-1")},
        {"quantity": D("NaN")},
        {"quantity": D("sNaN")},
        {"quantity": D("Infinity")},
        {"quantity": D("0.01")},
        {"quantity": 2.0},
        {"quantity": None},
        {"order_id": ""},
        {"order_id": []},
        {"account_id": ""},
        {"account_id": None},
    ],
)
def test_invalid_commands_preserve_everything(engine, changes):
    submit(engine, "maker", OrderSide.SELL)
    submit(engine, "filled", OrderSide.BUY, quantity="1")
    before = state(engine, "maker", "filled")
    arguments = dict(
        order_id="new",
        account_id="bob",
        side=OrderSide.BUY,
        price=D("100"),
        quantity=D("2"),
    )
    arguments.update(changes)
    with pytest.raises(OrderRejected):
        engine.submit(**arguments)
    assert state(engine, "maker", "filled") == before
    assert submit(engine, "new", OrderSide.BUY).order.order_id == "new"


@pytest.mark.parametrize("terminal", ["open", "filled", "cancelled"])
def test_duplicate_ids_and_terminal_cancellation(engine, terminal):
    submit(engine, "original", OrderSide.SELL)
    if terminal == "filled":
        submit(engine, "buyer", OrderSide.BUY)
    elif terminal == "cancelled":
        engine.cancel(order_id="original")
    before = state(engine, "original")
    with pytest.raises(OrderRejected, match="already been accepted"):
        submit(engine, "original", OrderSide.BUY)
    assert state(engine, "original") == before
    if terminal != "open":
        result = engine.cancel(order_id="original")
        assert result.order == engine.get_order(order_id="original")
        assert not result.executions and not result.changed_resting_orders
        assert result.cancellation_reason is None
        assert state(engine, "original") == before


def test_unknown_ids_do_not_mutate(engine):
    submit(engine, "maker", OrderSide.SELL)
    before = state(engine, "maker")
    for operation in (engine.cancel, engine.get_order):
        with pytest.raises(OrderNotFound):
            operation(order_id="unknown")
    assert state(engine, "maker") == before


@pytest.mark.parametrize("field", ["price_increment", "quantity_increment"])
@pytest.mark.parametrize("value", [D("0"), D("-1"), D("NaN"), D("Infinity"), 0.01])
def test_invalid_increments(field, value):
    with pytest.raises(OrderRejected):
        MatchingEngine(instrument=replace(INSTRUMENT, **{field: value}))


def test_exact_arithmetic_ignores_decimal_context():
    instrument = replace(
        INSTRUMENT, price_increment=D("0.05"), quantity_increment=D("0.03")
    )
    with localcontext() as context:
        context.prec = 2
        engine = MatchingEngine(instrument=instrument)
        submit(engine, "one", OrderSide.SELL, "123456789.15", "123456789.12")
        submit(engine, "two", OrderSide.SELL, "123456789.15", "0.09")
        assert engine.get_order_book().asks == (
            BookLevel(D("123456789.15"), D("123456789.21")),
        )
        result = submit(engine, "take", OrderSide.BUY, "123456789.20", "123456789.15")
        assert result.order.filled_quantity == D("123456789.15")
        assert [x.quantity for x in result.executions] == [D("123456789.12"), D("0.03")]
        assert engine.get_order_book().asks == (
            BookLevel(D("123456789.15"), D("0.06")),
        )
        before = state(engine)
        with pytest.raises(OrderRejected):
            submit(engine, "bad", OrderSide.BUY, "123456789.16", "0.03")
        assert state(engine) == before
        with pytest.raises(OrderRejected):
            submit(engine, "bad", OrderSide.BUY, "123456789.15", "0.04")
        assert state(engine) == before


def test_new_instance_starts_empty(engine):
    submit(engine, "one", OrderSide.SELL)
    fresh = MatchingEngine(instrument=INSTRUMENT)
    assert state(fresh) == ((), (), 0, (), ())
    with pytest.raises(OrderNotFound):
        fresh.get_order(order_id="one")
    submit(fresh, "one", OrderSide.SELL)
    assert state(engine)[:3] == state(fresh)[:3]
