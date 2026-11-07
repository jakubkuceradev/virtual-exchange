"""Exact integer conversion shared by matching and funded trading."""

from dataclasses import dataclass
from decimal import Decimal

from virtual_exchange.types import Instrument, OrderSide

# Bound digits and scale before integer conversion so hostile exponents or very
# long coefficients cannot make exact arithmetic allocate huge integers.
MAX_DIGITS = 38


class OrderRejected(ValueError):
    """Reject invalid input or an unavailable order operation."""


def coefficient(value: Decimal) -> tuple[int, int]:
    parts = value.as_tuple()
    if len(parts.digits) > MAX_DIGITS:
        raise OrderRejected("value has too many significant digits")
    result = 0
    for digit in parts.digits:
        result = result * 10 + digit
    return result, int(parts.exponent)


def positive_decimal(value: object, name: str) -> Decimal:
    if not isinstance(value, Decimal) or not value.is_finite() or value <= 0:
        raise OrderRejected(f"{name} must be a finite positive Decimal")
    return value


def units(value: Decimal, increment: Decimal) -> int:
    amount, exponent = coefficient(value)
    step, step_exponent = coefficient(increment)
    difference = exponent - step_exponent
    if difference > MAX_DIGITS:
        raise OrderRejected("value is outside the supported range")
    if difference < -MAX_DIGITS:
        # A nonzero coefficient below 10**MAX_DIGITS cannot be a multiple of the
        # increment scaled by more than MAX_DIGITS decimal places.
        if amount:
            raise OrderRejected("value must align with the configured increment")
        return 0
    result, remainder = divmod(
        amount * 10 ** max(difference, 0), step * 10 ** max(-difference, 0)
    )
    if remainder:
        raise OrderRejected("value must align with the configured increment")
    return result


def decimal(units: int, increment: Decimal) -> Decimal:
    step, exponent = coefficient(increment)
    return Decimal((0, Decimal(units * step).as_tuple().digits, exponent))


@dataclass(frozen=True, slots=True)
class Amounts:
    """Own an instrument's exact price, inventory, and cash units."""

    instrument: Instrument

    def __post_init__(self) -> None:
        positive_decimal(self.instrument.price_increment, "price_increment")
        positive_decimal(self.instrument.quantity_increment, "quantity_increment")
        if any(
            not isinstance(v, str) or not v
            for v in (
                self.instrument.instrument_id,
                self.instrument.base_asset,
                self.instrument.quote_asset,
            )
        ):
            raise OrderRejected("instrument identifiers must be nonempty strings")
        if self.instrument.base_asset == self.instrument.quote_asset:
            raise OrderRejected("instrument assets must differ")

    @property
    def cash_increment(self) -> Decimal:
        price, pe = coefficient(self.instrument.price_increment)
        lot, le = coefficient(self.instrument.quantity_increment)
        return Decimal((0, Decimal(price * lot).as_tuple().digits, pe + le))

    def order(
        self, *, side: OrderSide, price: Decimal, quantity: Decimal
    ) -> tuple[int, int]:
        if not isinstance(side, OrderSide):
            raise OrderRejected("side must be an OrderSide")
        return (
            units(positive_decimal(price, "price"), self.instrument.price_increment),
            units(
                positive_decimal(quantity, "quantity"),
                self.instrument.quantity_increment,
            ),
        )

    def allocation(self, value: Decimal, *, cash: bool) -> int:
        if not isinstance(value, Decimal) or not value.is_finite() or value < 0:
            raise OrderRejected("allocation must be a finite nonnegative Decimal")
        return units(
            value, self.cash_increment if cash else self.instrument.quantity_increment
        )
