"""Sequential single-instrument matching, independent of funding and transport."""

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from virtual_exchange.types import (
    BookLevel,
    CancellationReason,
    Execution,
    Instrument,
    MatchingResult,
    OrderBookSnapshot,
    OrderSide,
    OrderSnapshot,
    OrderStatus,
)


class OrderRejected(ValueError):
    """Reject invalid input or a terminal cancellation before changing state."""


class OrderNotFound(KeyError):
    """Identify an order absent from this engine instance."""


def _coefficient(value: Decimal) -> tuple[int, int]:
    """Read an exact positive Decimal coefficient and exponent."""
    parts = value.as_tuple()
    coefficient = 0
    for digit in parts.digits:
        coefficient = coefficient * 10 + digit
    return coefficient, int(parts.exponent)


def _positive_decimal(value: object, name: str) -> Decimal:
    if not isinstance(value, Decimal) or not value.is_finite() or value <= 0:
        raise OrderRejected(f"{name} must be a finite positive Decimal")
    return value


def _units(value: Decimal, increment: Decimal) -> int:
    coefficient, exponent = _coefficient(value)
    step, step_exponent = _coefficient(increment)
    difference = exponent - step_exponent
    numerator = coefficient * 10 ** max(difference, 0)
    denominator = step * 10 ** max(-difference, 0)
    units, remainder = divmod(numerator, denominator)
    if remainder:
        raise OrderRejected("value must align with the configured increment")
    return units


def _decimal(units: int, increment: Decimal) -> Decimal:
    coefficient, exponent = _coefficient(increment)
    # Integer arithmetic and tuple construction never consult Decimal precision.
    digits = Decimal(units * coefficient).as_tuple().digits
    return Decimal((0, digits, exponent))


class MatchingEngine:
    """Own a complete in-memory book; callers supply eligible orders sequentially."""

    def __init__(self, *, instrument: Instrument) -> None:
        _positive_decimal(instrument.price_increment, "price_increment")
        _positive_decimal(instrument.quantity_increment, "quantity_increment")
        if (
            not isinstance(instrument.instrument_id, str)
            or not instrument.instrument_id
        ):
            raise OrderRejected("instrument_id must be a nonempty string")
        self._instrument = instrument
        self._orders: dict[str, OrderSnapshot] = {}
        # Insertion order is engine receipt order. Updating retains that priority.
        self._resting: dict[str, tuple[int, int]] = {}
        self._executions: list[Execution] = []
        self._sequence = 0

    def submit(
        self,
        *,
        account_id: str,
        side: OrderSide,
        price: Decimal,
        quantity: Decimal,
        client_order_id: str | None = None,
    ) -> MatchingResult:
        """Validate then match at maker prices, resting any eligible remainder."""
        self._validate_id(account_id, "account_id")
        if client_order_id is not None:
            self._validate_id(client_order_id, "client_order_id")
        if not isinstance(side, OrderSide):
            raise OrderRejected("side must be an OrderSide")
        ticks = _units(
            _positive_decimal(price, "price"), self._instrument.price_increment
        )
        lots = _units(
            _positive_decimal(quantity, "quantity"), self._instrument.quantity_increment
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
        )
        remaining = lots
        executions = []
        changed = []
        filled = 0
        prevented = 0
        # Stable sorting preserves receipt priority for equal-price makers.
        makers = sorted(
            (
                (maker_id, maker_ticks, maker_lots)
                for maker_id, (maker_ticks, maker_lots) in self._resting.items()
                if self._orders[maker_id].side != side
            ),
            key=lambda maker: maker[1] if side == OrderSide.BUY else -maker[1],
        )
        for maker_id, maker_ticks, maker_lots in makers:
            if not remaining:
                break
            if (side == OrderSide.BUY and maker_ticks > ticks) or (
                side == OrderSide.SELL and maker_ticks < ticks
            ):
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
            if is_self_trade:
                continue
            executions.append(
                Execution(
                    execution_id=str(len(self._executions) + len(executions) + 1),
                    instrument_id=self._instrument.instrument_id,
                    maker_order_id=maker_id,
                    taker_order_id=order_id,
                    price=_decimal(maker_ticks, self._instrument.price_increment),
                    quantity=_decimal(removed, self._instrument.quantity_increment),
                    executed_at=now,
                )
            )
        order = self._snapshot(
            order, remaining=remaining, filled=filled, prevented=prevented
        )
        self._orders[order_id] = order
        if remaining:
            self._resting[order_id] = (ticks, remaining)
        self._executions.extend(executions)
        self._sequence += 1
        reason = CancellationReason.SELF_TRADE if prevented and not remaining else None
        return MatchingResult(order, tuple(changed), tuple(executions), reason)

    def cancel(self, *, order_id: str) -> MatchingResult:
        """Cancel an open remainder; reject unknown or terminal orders unchanged."""
        order = self.get_order(order_id=order_id)
        if order.status in (OrderStatus.FILLED, OrderStatus.CANCELLED):
            raise OrderRejected("order is already finished")
        _, remaining = self._resting.pop(order_id)
        order = replace(
            order,
            status=OrderStatus.CANCELLED,
            remaining_quantity=_decimal(0, self._instrument.quantity_increment),
            cancelled_quantity=_decimal(remaining, self._instrument.quantity_increment),
        )
        self._orders[order_id] = order
        self._sequence += 1
        return MatchingResult(order, cancellation_reason=CancellationReason.REQUESTED)

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
        for order_id, (ticks, lots) in self._resting.items():
            side_levels = bids if self._orders[order_id].side == OrderSide.BUY else asks
            side_levels[ticks] = side_levels.get(ticks, 0) + lots

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

    def list_executions(self) -> tuple[Execution, ...]:
        """Return immutable execution history in matching order."""
        return tuple(self._executions)

    @staticmethod
    def _validate_id(value: str, name: str) -> None:
        if not isinstance(value, str) or not value:
            raise OrderRejected(f"{name} must be a nonempty string")
