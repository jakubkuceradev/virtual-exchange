"""Sequential single-instrument matching, independent of funding and transport."""

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

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
    """Reject an invalid or duplicate command before changing state."""


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
        order_id: str,
        account_id: str,
        side: OrderSide,
        price: Decimal,
        quantity: Decimal,
    ) -> MatchingResult:
        """Validate then match at maker prices, resting any eligible remainder."""
        self._validate_id(order_id, "order_id")
        self._validate_id(account_id, "account_id")
        if order_id in self._orders:
            raise OrderRejected("order_id has already been accepted")
        if not isinstance(side, OrderSide):
            raise OrderRejected("side must be an OrderSide")
        ticks = _units(
            _positive_decimal(price, "price"), self._instrument.price_increment
        )
        lots = _units(
            _positive_decimal(quantity, "quantity"), self._instrument.quantity_increment
        )
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
        )
        remaining = lots
        executions = []
        changed = []
        reason = None
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
            if maker.account_id == account_id:
                reason = CancellationReason.SELF_TRADE
                break
            traded = min(remaining, maker_lots)
            remaining -= traded
            maker_remaining = maker_lots - traded
            maker = replace(
                maker,
                filled_quantity=_decimal(
                    _units(maker.quantity, self._instrument.quantity_increment)
                    - maker_remaining,
                    self._instrument.quantity_increment,
                ),
                status=(
                    OrderStatus.PARTIALLY_FILLED
                    if maker_remaining
                    else OrderStatus.FILLED
                ),
            )
            self._orders[maker_id] = maker
            changed.append(maker)
            if maker_remaining:
                self._resting[maker_id] = (maker_ticks, maker_remaining)
            else:
                del self._resting[maker_id]
            executions.append(
                Execution(
                    execution_id=str(len(self._executions) + len(executions) + 1),
                    instrument_id=self._instrument.instrument_id,
                    maker_order_id=maker_id,
                    taker_order_id=order_id,
                    price=_decimal(maker_ticks, self._instrument.price_increment),
                    quantity=_decimal(traded, self._instrument.quantity_increment),
                    executed_at=now,
                )
            )
        if reason is not None:
            status = OrderStatus.CANCELLED
        elif not remaining:
            status = OrderStatus.FILLED
        elif remaining < lots:
            status = OrderStatus.PARTIALLY_FILLED
        else:
            status = OrderStatus.OPEN
        order = replace(
            order,
            filled_quantity=_decimal(
                lots - remaining, self._instrument.quantity_increment
            ),
            status=status,
        )
        self._orders[order_id] = order
        if remaining and reason is None:
            self._resting[order_id] = (ticks, remaining)
        self._executions.extend(executions)
        self._sequence += 1
        return MatchingResult(order, tuple(changed), tuple(executions), reason)

    def cancel(self, *, order_id: str) -> MatchingResult:
        """Remove only an open remainder; terminal cancellation is a no-op."""
        order = self.get_order(order_id=order_id)
        if order.status in (OrderStatus.FILLED, OrderStatus.CANCELLED):
            return MatchingResult(order)
        del self._resting[order_id]
        order = replace(order, status=OrderStatus.CANCELLED)
        self._orders[order_id] = order
        self._sequence += 1
        return MatchingResult(order, cancellation_reason=CancellationReason.REQUESTED)

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
