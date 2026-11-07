"""Verify sequential matching and explicit execution/prevention accounting."""

from dataclasses import FrozenInstanceError, replace
from decimal import Decimal, localcontext
from uuid import UUID

import pytest

from virtual_exchange.exchange.matching import (
    MatchingEngine,
    OrderNotFound,
    OrderRejected,
)
from virtual_exchange.types import (
    BookLevel,
    Instrument,
    OrderSide,
    OrderStatus,
)

D = Decimal
INSTRUMENT = Instrument("ABC-USD", "ABC", "USD", D("0.01"), D("0.1"))


@pytest.fixture
def engine():
    return MatchingEngine(instrument=INSTRUMENT)


def submit(engine, side, price="100", quantity="2", owner="alice", client_id=None):
    return engine.submit(
        account_id=owner,
        side=side,
        price=D(price),
        quantity=D(quantity),
        client_order_id=client_id,
    )


def state(engine, *orders):
    book = engine.get_order_book()
    return (
        book.bids,
        book.asks,
        book.sequence,
        engine.list_executions(),
        tuple(engine.get_order(order_id=order.order_id) for order in orders),
    )


def assert_quantities(order, filled="0", remaining="0", prevented="0", cancelled="0"):
    assert (
        order.filled_quantity,
        order.remaining_quantity,
        order.prevented_quantity,
        order.cancelled_quantity,
    ) == tuple(D(value) for value in (filled, remaining, prevented, cancelled))
    assert order.quantity == sum(
        (
            order.filled_quantity,
            order.remaining_quantity,
            order.prevented_quantity,
            order.cancelled_quantity,
        )
    )


@pytest.mark.parametrize("maker_side", list(OrderSide))
def test_first_vertical_slice(engine, maker_side):
    taker_side = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    original = submit(engine, maker_side, owner="bob").order
    result = submit(engine, taker_side)
    maker = engine.get_order(order_id=original.order_id)
    assert maker.status == result.order.status == OrderStatus.FILLED
    assert_quantities(maker, filled="2")
    assert_quantities(result.order, filled="2")
    assert original.status == OrderStatus.OPEN
    assert result.changed_resting_orders == (maker,)
    (execution,) = result.executions
    assert (execution.maker_order_id, execution.taker_order_id) == (
        maker.order_id,
        result.order.order_id,
    )
    assert (execution.price, execution.quantity) == (D("100"), D("2"))
    assert execution.executed_at.utcoffset().total_seconds() == 0
    assert result.order.accepted_at.utcoffset().total_seconds() == 0
    assert state(engine)[:2] == ((), ())
    assert engine.list_executions() == result.executions
    with pytest.raises(FrozenInstanceError):
        result.order.quantity = D("3")


@pytest.mark.parametrize(
    "maker_side,taker_side,best,worse,outside",
    [
        (OrderSide.SELL, OrderSide.BUY, "99", "100", "101"),
        (OrderSide.BUY, OrderSide.SELL, "101", "100", "99"),
    ],
)
def test_multilevel_priority_and_partial_cancellation(
    engine, maker_side, taker_side, best, worse, outside
):
    second = submit(engine, maker_side, worse, "5", "bob").order
    first = submit(engine, maker_side, best, "4", "bob").order
    untouched = submit(engine, maker_side, outside, owner="bob").order
    result = submit(engine, taker_side, "100", "10")
    assert [(x.maker_order_id, x.price, x.quantity) for x in result.executions] == [
        (first.order_id, D(best), D("4")),
        (second.order_id, D(worse), D("5")),
    ]
    assert_quantities(result.order, filled="9", remaining="1")
    assert result.order.status == OrderStatus.PARTIALLY_FILLED
    book = engine.get_order_book()
    assert (book.bids if taker_side == OrderSide.BUY else book.asks) == (
        BookLevel(D("100"), D("1")),
    )
    executions = engine.list_executions()
    cancelled = engine.cancel(order_id=result.order.order_id)
    assert_quantities(cancelled.order, filled="9", cancelled="1")
    assert cancelled.order.status == OrderStatus.CANCELLED
    assert engine.list_executions() == executions
    assert engine.get_order(order_id=untouched.order_id) == untouched


@pytest.mark.parametrize("maker_side", list(OrderSide))
def test_fifo_after_partial_execution(engine, maker_side):
    taker_side = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    first = submit(engine, maker_side, quantity="4", owner="bob").order
    second = submit(engine, maker_side, quantity="3", owner="bob").order
    submit(engine, taker_side, quantity="1")
    result = submit(engine, taker_side, quantity="4")
    assert [(x.maker_order_id, x.quantity) for x in result.executions] == [
        (first.order_id, D("3")),
        (second.order_id, D("1")),
    ]
    assert len({x.execution_id for x in engine.list_executions()}) == 3


@pytest.mark.parametrize("maker_side", list(OrderSide))
@pytest.mark.parametrize(
    "maker_quantity,taker_quantity", [("3", "5"), ("5", "3"), ("3", "3")]
)
def test_decrement_and_cancel_both_directions(
    engine, maker_side, maker_quantity, taker_quantity
):
    taker_side = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    maker = submit(engine, maker_side, quantity=maker_quantity).order
    result = submit(engine, taker_side, quantity=taker_quantity)
    updated = engine.get_order(order_id=maker.order_id)
    prevented = min(D(maker_quantity), D(taker_quantity))
    assert_quantities(
        updated, remaining=str(D(maker_quantity) - prevented), prevented=str(prevented)
    )
    assert_quantities(
        result.order,
        remaining=str(D(taker_quantity) - prevented),
        prevented=str(prevented),
    )
    assert updated.status == (
        OrderStatus.OPEN if updated.remaining_quantity else OrderStatus.CANCELLED
    )
    assert result.order.status == (
        OrderStatus.OPEN if result.order.remaining_quantity else OrderStatus.CANCELLED
    )
    assert result.changed_resting_orders == (updated,)
    assert not result.executions and not engine.list_executions()


@pytest.mark.parametrize("maker_side", list(OrderSide))
def test_prevention_preserves_prior_fills_and_continues_matching(engine, maker_side):
    taker_side = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    other = submit(
        engine, maker_side, "99" if maker_side == OrderSide.SELL else "101", "1", "bob"
    ).order
    own = submit(engine, maker_side, quantity="3").order
    result = submit(engine, taker_side, quantity="5")
    assert_quantities(result.order, filled="1", remaining="1", prevented="3")
    assert result.order.status == OrderStatus.PARTIALLY_FILLED
    assert [x.maker_order_id for x in result.executions] == [other.order_id]
    assert_quantities(engine.get_order(order_id=own.order_id), prevented="3")
    # A subsequent external fill must not count prevented quantity as executed.
    final = submit(engine, maker_side, quantity="1", owner="carol")
    updated = final.changed_resting_orders[0]
    assert_quantities(updated, filled="2", prevented="3")
    assert updated.status == OrderStatus.CANCELLED


@pytest.mark.parametrize("maker_side", list(OrderSide))
def test_larger_incoming_continues_past_self_order(engine, maker_side):
    opposite = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    own = submit(engine, maker_side, quantity="2").order
    other = submit(engine, maker_side, quantity="1", owner="bob").order
    result = submit(engine, opposite, quantity="4")
    assert_quantities(result.order, filled="1", remaining="1", prevented="2")
    assert [o.order_id for o in result.changed_resting_orders] == [
        own.order_id,
        other.order_id,
    ]
    assert [x.maker_order_id for x in result.executions] == [other.order_id]


@pytest.mark.parametrize("maker_side", list(OrderSide))
def test_prevented_resting_order_retains_fifo_and_cancels_only_remainder(
    engine, maker_side
):
    opposite = OrderSide.BUY if maker_side == OrderSide.SELL else OrderSide.SELL
    first = submit(engine, maker_side, quantity="5").order
    later = submit(engine, maker_side, quantity="2", owner="bob").order
    submit(engine, opposite, quantity="1", owner="carol")
    submit(engine, opposite, quantity="2")
    reduced = engine.get_order(order_id=first.order_id)
    assert_quantities(reduced, filled="1", remaining="2", prevented="2")
    result = submit(engine, opposite, quantity="1", owner="carol")
    assert [x.maker_order_id for x in result.executions] == [first.order_id]
    cancelled = engine.cancel(order_id=first.order_id).order
    assert_quantities(cancelled, filled="2", prevented="2", cancelled="1")
    assert engine.get_order(order_id=later.order_id) == later


def test_exchange_ids_and_repeated_client_metadata(engine):
    orders = [submit(engine, OrderSide.BUY, client_id="same").order for _ in range(3)]
    assert len({o.order_id for o in orders}) == 3
    assert all(
        UUID(o.order_id).version == 4 and o.client_order_id == "same" for o in orders
    )
    engine.cancel(order_id=orders[0].order_id)
    assert submit(engine, OrderSide.BUY, client_id="same").order.order_id not in {
        o.order_id for o in orders
    }
    assert submit(engine, OrderSide.BUY).order.client_order_id is None


@pytest.mark.parametrize("terminal", ["filled", "cancelled"])
def test_terminal_cancellations_error_unchanged(engine, terminal):
    order = submit(engine, OrderSide.SELL).order
    if terminal == "filled":
        submit(engine, OrderSide.BUY, owner="bob")
    else:
        engine.cancel(order_id=order.order_id)
    before = state(engine, order)
    with pytest.raises(OrderRejected, match="already finished"):
        engine.cancel(order_id=order.order_id)
    assert state(engine, order) == before


def test_unknown_ids_error_unchanged(engine):
    order = submit(engine, OrderSide.BUY).order
    before = state(engine, order)
    for operation in (engine.cancel, engine.get_order):
        with pytest.raises(OrderNotFound):
            operation(order_id="unknown")
    assert state(engine, order) == before


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
        {"client_order_id": ""},
        {"client_order_id": []},
        {"account_id": ""},
        {"account_id": None},
    ],
)
def test_invalid_commands_preserve_everything(engine, changes):
    maker = submit(engine, OrderSide.SELL, owner="bob").order
    filled = submit(engine, OrderSide.BUY, quantity="1").order
    before = state(engine, maker, filled)
    arguments = dict(
        client_order_id="new",
        account_id="alice",
        side=OrderSide.BUY,
        price=D("100"),
        quantity=D("2"),
    )
    arguments.update(changes)
    with pytest.raises(OrderRejected):
        engine.submit(**arguments)
    assert state(engine, maker, filled) == before


@pytest.mark.parametrize("field", ["price_increment", "quantity_increment"])
@pytest.mark.parametrize("value", [D("0"), D("-1"), D("NaN"), D("Infinity"), 0.01])
def test_invalid_increments(field, value):
    with pytest.raises(OrderRejected):
        MatchingEngine(instrument=replace(INSTRUMENT, **{field: value}))


def test_exact_arithmetic_and_prevention_ignore_decimal_context():
    instrument = replace(
        INSTRUMENT, price_increment=D("0.05"), quantity_increment=D("0.03")
    )
    with localcontext() as context:
        context.prec = 2
        engine = MatchingEngine(instrument=instrument)
        submit(engine, OrderSide.SELL, "123456789.15", "123456789.12", "bob")
        own = submit(engine, OrderSide.SELL, "123456789.15", "0.09").order
        assert engine.get_order_book().asks == (
            BookLevel(D("123456789.15"), D("123456789.21")),
        )
        result = submit(engine, OrderSide.BUY, "123456789.20", "123456789.15")
        assert result.order.filled_quantity == D("123456789.12")
        assert result.order.prevented_quantity == D("0.03")
        assert result.order.remaining_quantity == 0
        assert engine.get_order(order_id=own.order_id).remaining_quantity == D("0.06")
        assert engine.get_order_book().asks == (
            BookLevel(D("123456789.15"), D("0.06")),
        )
        before = state(engine, own, result.order)
        for price, quantity in [("123456789.16", "0.03"), ("123456789.15", "0.04")]:
            with pytest.raises(OrderRejected):
                submit(engine, OrderSide.BUY, price, quantity)
        assert state(engine, own, result.order) == before


def test_empty_noncrossing_and_reset(engine):
    assert state(engine) == ((), (), 0, (), ())
    order = submit(engine, OrderSide.BUY, "99").order
    submit(engine, OrderSide.BUY, "99", "3")
    submit(engine, OrderSide.SELL, "101", owner="bob")
    assert state(engine)[:2] == (
        (BookLevel(D("99"), D("5")),),
        (BookLevel(D("101"), D("2")),),
    )
    fresh = MatchingEngine(instrument=INSTRUMENT)
    assert state(fresh) == ((), (), 0, (), ())
    with pytest.raises(OrderNotFound):
        fresh.get_order(order_id=order.order_id)


def test_mixed_commands_conserve_quantities_and_book(engine):
    """Check cumulative reductions across interleaved owners, fills, and cancels."""
    from random import Random

    random = Random(709)
    accepted = []
    for _ in range(150):
        if accepted and random.randrange(5) == 0:
            order_id = random.choice(accepted)
            try:
                engine.cancel(order_id=order_id)
            except OrderRejected:
                pass
        else:
            result = submit(
                engine,
                random.choice(list(OrderSide)),
                str(random.randint(98, 102)),
                str(random.randint(1, 7)),
                random.choice(["alice", "bob", "carol"]),
            )
            accepted.append(result.order.order_id)
        orders = {
            order_id: engine.get_order(order_id=order_id) for order_id in accepted
        }
        executed = dict.fromkeys(accepted, D(0))
        for execution in engine.list_executions():
            maker = orders[execution.maker_order_id]
            taker = orders[execution.taker_order_id]
            assert maker.account_id != taker.account_id
            assert execution.price == maker.limit_price
            executed[maker.order_id] += execution.quantity
            executed[taker.order_id] += execution.quantity
        bids, asks = {}, {}
        for order in orders.values():
            assert order.quantity == (
                order.filled_quantity
                + order.remaining_quantity
                + order.prevented_quantity
                + order.cancelled_quantity
            )
            assert order.filled_quantity == executed[order.order_id]
            assert (order.remaining_quantity > 0) == (
                order.status in (OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED)
            )
            if order.remaining_quantity:
                levels = bids if order.side == OrderSide.BUY else asks
                levels[order.limit_price] = (
                    levels.get(order.limit_price, D(0)) + order.remaining_quantity
                )
        book = engine.get_order_book()
        assert book.bids == tuple(
            BookLevel(p, bids[p]) for p in sorted(bids, reverse=True)
        )
        assert book.asks == tuple(BookLevel(p, asks[p]) for p in sorted(asks))
        if bids and asks:
            assert max(bids) < min(asks)
