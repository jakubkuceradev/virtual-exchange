"""Sequential single-instrument matching, independent of funding and transport."""

from collections import ChainMap
from collections.abc import MutableMapping
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from virtual_exchange.amounts import (
    Amounts,
    OrderRejected,
)
from virtual_exchange.amounts import (
    decimal as _decimal,
)
from virtual_exchange.amounts import (
    units as _units,
)
from virtual_exchange.types import (
    BookLevel,
    Execution,
    Instrument,
    MatchingResult,
    OrderBookSnapshot,
    OrderSide,
    OrderSnapshot,
    OrderStatus,
    TimeInForce,
)


class OrderNotFound(KeyError):
    """Identify an order absent from this engine instance."""


class MatchingEngine:
    """Own a complete in-memory book; callers supply eligible orders sequentially."""

    def __init__(self, *, instrument: Instrument) -> None:
        Amounts(instrument)
        self._instrument = instrument
        self._orders: MutableMapping[str, OrderSnapshot] = {}
        # Insertion order is engine receipt order. Updating retains that priority.
        self._resting: dict[str, tuple[int, int]] = {}
        # Aggregate open lots per (side, price ticks), maintained incrementally.
        self._levels: dict[tuple[OrderSide, int], int] = {}
        self._executions: list[Execution] = []
        self._sequence = 0
        # A candidate reads its parent's retained history without copying it.
        self._parent: MatchingEngine | None = None
        self._execution_offset = 0
        self._base_sequence = 0
        self._spent = False

    def fork(self) -> MatchingEngine:
        """Start a private candidate for a coordinated trading operation.

        Retained history is overlaid rather than copied, so the cost is
        proportional to open orders and price levels, not process lifetime.
        """
        if self._parent is not None or self._spent:
            raise RuntimeError("a candidate cannot be forked")
        candidate = MatchingEngine(instrument=self._instrument)
        candidate._parent = self
        candidate._orders = ChainMap({}, self._orders)
        candidate._resting = self._resting.copy()
        candidate._levels = self._levels.copy()
        candidate._execution_offset = len(self._executions)
        candidate._base_sequence = candidate._sequence = self._sequence
        return candidate

    def commit(self, candidate: MatchingEngine) -> None:
        """Absorb a successful candidate forked from this unchanged engine."""
        # Every effective command advances the sequence, so an unchanged
        # sequence proves no other candidate committed after this fork.
        if candidate._parent is not self or candidate._base_sequence != self._sequence:
            raise RuntimeError("candidate does not extend this engine")
        assert isinstance(candidate._orders, ChainMap)
        self._orders.update(candidate._orders.maps[0])
        self._resting = candidate._resting
        self._levels = candidate._levels
        self._executions.extend(candidate._executions)
        self._sequence = candidate._sequence
        candidate._parent = None
        candidate._spent = True

    def submit(
        self,
        *,
        account_id: str,
        side: OrderSide,
        price: Decimal,
        quantity: Decimal,
        client_order_id: str | None = None,
        time_in_force: TimeInForce = TimeInForce.GTC,
    ) -> MatchingResult:
        """Validate then match at maker prices, resting any eligible remainder.

        An IOC remainder is cancelled instead of resting, so it never enters the book.
        """
        self._validate_id(account_id, "account_id")
        if not isinstance(time_in_force, TimeInForce):
            raise OrderRejected("time_in_force must be a TimeInForce")
        if client_order_id is not None:
            self._validate_id(client_order_id, "client_order_id")
        ticks, lots = Amounts(self._instrument).order(
            side=side, price=price, quantity=quantity
        )
        order_id = str(uuid4())
        while order_id in self._orders:
            order_id = str(uuid4())
        now = datetime.now(UTC)
        order = OrderSnapshot(
            order_id=order_id,
            account_id=account_id,
            instrument_id=self._instrument.instrument_id,
            side=side,
            quantity=_decimal(lots, self._instrument.quantity_increment),
            filled_quantity=_decimal(0, self._instrument.quantity_increment),
            limit_price=_decimal(ticks, self._instrument.price_increment),
            status=OrderStatus.OPEN,
            accepted_at=now,
            client_order_id=client_order_id,
            remaining_quantity=_decimal(lots, self._instrument.quantity_increment),
            time_in_force=time_in_force,
        )
        remaining = lots
        executions = []
        changed = []
        filled = 0
        prevented = 0
        maker_side = OrderSide.SELL if side == OrderSide.BUY else OrderSide.BUY
        # Only crossing levels can match; skip the scan when none exist.
        crossing = any(
            level_side == maker_side
            and (
                level_ticks <= ticks if side == OrderSide.BUY else level_ticks >= ticks
            )
            for level_side, level_ticks in self._levels
        )
        # Stable sorting preserves receipt priority for equal-price makers.
        makers = sorted(
            (
                (maker_id, maker_ticks, maker_lots)
                for maker_id, (maker_ticks, maker_lots) in self._resting.items()
                if (
                    maker_ticks <= ticks
                    if side == OrderSide.BUY
                    else maker_ticks >= ticks
                )
                and self._orders[maker_id].side == maker_side
            )
            if crossing
            else (),
            key=lambda maker: maker[1] if side == OrderSide.BUY else -maker[1],
        )
        for maker_id, maker_ticks, maker_lots in makers:
            if not remaining:
                break
            maker = self._orders[maker_id]
            is_self_trade = maker.account_id == account_id
            removed = min(remaining, maker_lots)
            remaining -= removed
            maker_remaining = maker_lots - removed
            maker_filled = _units(
                maker.filled_quantity, self._instrument.quantity_increment
            )
            maker_prevented = _units(
                maker.prevented_quantity, self._instrument.quantity_increment
            )
            if is_self_trade:
                prevented += removed
                maker_prevented += removed
            else:
                filled += removed
                maker_filled += removed
            maker = self._snapshot(
                maker,
                remaining=maker_remaining,
                filled=maker_filled,
                prevented=maker_prevented,
            )
            self._orders[maker_id] = maker
            changed.append(maker)
            if maker_remaining:
                self._resting[maker_id] = (maker_ticks, maker_remaining)
            else:
                del self._resting[maker_id]
            self._adjust_level(maker_side, maker_ticks, -removed)
            if is_self_trade:
                continue
            executions.append(
                Execution(
                    execution_id=str(
                        self._execution_offset
                        + len(self._executions)
                        + len(executions)
                        + 1
                    ),
                    instrument_id=self._instrument.instrument_id,
                    maker_order_id=maker_id,
                    taker_order_id=order_id,
                    price=_decimal(maker_ticks, self._instrument.price_increment),
                    quantity=_decimal(removed, self._instrument.quantity_increment),
                    executed_at=now,
                    side=maker_side,
                )
            )
        order = self._snapshot(
            order, remaining=remaining, filled=filled, prevented=prevented
        )
        if remaining and time_in_force == TimeInForce.IOC:
            order = replace(
                order,
                status=OrderStatus.CANCELLED,
                remaining_quantity=_decimal(0, self._instrument.quantity_increment),
                cancelled_quantity=_decimal(
                    remaining, self._instrument.quantity_increment
                ),
            )
            remaining = 0
        self._orders[order_id] = order
        if remaining:
            self._resting[order_id] = (ticks, remaining)
            self._adjust_level(side, ticks, remaining)
        self._executions.extend(executions)
        self._sequence += 1
        return MatchingResult(order, tuple(changed), tuple(executions))

    def cancel(self, *, order_id: str) -> MatchingResult:
        """Cancel an open remainder; reject unknown or terminal orders unchanged."""
        order = self.get_order(order_id=order_id)
        if order.status in (OrderStatus.FILLED, OrderStatus.CANCELLED):
            raise OrderRejected("order is already finished")
        ticks, remaining = self._resting.pop(order_id)
        self._adjust_level(order.side, ticks, -remaining)
        order = replace(
            order,
            status=OrderStatus.CANCELLED,
            remaining_quantity=_decimal(0, self._instrument.quantity_increment),
            cancelled_quantity=_decimal(remaining, self._instrument.quantity_increment),
        )
        self._orders[order_id] = order
        self._sequence += 1
        return MatchingResult(order)

    def _adjust_level(self, side: OrderSide, ticks: int, lots: int) -> None:
        total = self._levels.get((side, ticks), 0) + lots
        if total:
            self._levels[side, ticks] = total
        else:
            del self._levels[side, ticks]

    def _snapshot(
        self, order: OrderSnapshot, *, remaining: int, filled: int, prevented: int
    ) -> OrderSnapshot:
        if remaining:
            status = OrderStatus.PARTIALLY_FILLED if filled else OrderStatus.OPEN
        else:
            status = OrderStatus.CANCELLED if prevented else OrderStatus.FILLED
        return replace(
            order,
            status=status,
            filled_quantity=_decimal(filled, self._instrument.quantity_increment),
            prevented_quantity=_decimal(prevented, self._instrument.quantity_increment),
            remaining_quantity=_decimal(remaining, self._instrument.quantity_increment),
        )

    def get_order(self, *, order_id: str) -> OrderSnapshot:
        """Return an immutable accepted order, including terminal orders."""
        self._validate_id(order_id, "order_id")
        try:
            return self._orders[order_id]
        except KeyError:
            raise OrderNotFound(order_id) from None

    def get_order_book(self) -> OrderBookSnapshot:
        """Aggregate remaining liquidity, best price first on each side."""
        bids: dict[int, int] = {}
        asks: dict[int, int] = {}
        for (side, ticks), lots in self._levels.items():
            (bids if side == OrderSide.BUY else asks)[ticks] = lots

        def levels(values: dict[int, int], *, reverse: bool) -> tuple[BookLevel, ...]:
            return tuple(
                BookLevel(
                    _decimal(ticks, self._instrument.price_increment),
                    _decimal(values[ticks], self._instrument.quantity_increment),
                )
                for ticks in sorted(values, reverse=reverse)
            )

        return OrderBookSnapshot(
            instrument_id=self._instrument.instrument_id,
            bids=levels(bids, reverse=True),
            asks=levels(asks, reverse=False),
            sequence=self._sequence,
            observed_at=datetime.now(UTC),
        )

    def list_open_orders(self) -> tuple[OrderSnapshot, ...]:
        """Return resting orders in receipt order; terminal history is excluded."""
        return tuple(self._orders[order_id] for order_id in self._resting)

    def get_level(self, *, side: OrderSide, price: Decimal) -> Decimal:
        """Return aggregate open quantity at one price level, zero when empty."""
        ticks = _units(price, self._instrument.price_increment)
        return _decimal(
            self._levels.get((side, ticks), 0), self._instrument.quantity_increment
        )

    def list_executions(
        self, *, start: int = 0, stop: int | None = None
    ) -> tuple[Execution, ...]:
        """Return immutable execution history in matching order, optionally sliced."""
        history = self._executions
        if self._parent is not None:
            history = [*self._parent._executions, *self._executions]
        return tuple(history[start:stop])

    def count_executions(self) -> int:
        """Return the number of executions retained by this instance."""
        return self._execution_offset + len(self._executions)

    @staticmethod
    def _validate_id(value: str, name: str) -> None:
        if not isinstance(value, str) or not value:
            raise OrderRejected(f"{name} must be a nonempty string")
