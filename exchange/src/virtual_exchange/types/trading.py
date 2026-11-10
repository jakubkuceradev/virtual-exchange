"""Experimental trading result records; contracts are not yet finalized."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum


class OrderSide(StrEnum):
    """Describe whether an order buys or sells an instrument."""

    BUY = "buy"
    SELL = "sell"


class Liquidity(StrEnum):
    """Say whether an owned order provided resting liquidity or took it."""

    MAKER = "maker"
    TAKER = "taker"


class TimeInForce(StrEnum):
    """Say how long an order's unfilled quantity may rest, following Coinbase."""

    GTC = "GTC"  # good till cancelled: the remainder rests on the book
    IOC = "IOC"  # immediate or cancel: the remainder is cancelled at once


class Funding(StrEnum):
    """Operator-assigned funding policy for one account."""

    FUNDED = "funded"  # orders need available balances and place holds
    UNLIMITED = "unlimited"  # never limited by funds; balances may go negative


class OrderStatus(StrEnum):
    """Describe the current lifecycle state of an accepted order."""

    OPEN = "open"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class Instrument:
    """Describe a tradable asset pair and its price and quantity increments."""

    instrument_id: str
    base_asset: str
    quote_asset: str
    price_increment: Decimal
    quantity_increment: Decimal


@dataclass(frozen=True, slots=True)
class Balance:
    """Report an asset's available and reserved account balances."""

    asset_id: str
    available: Decimal
    reserved: Decimal


@dataclass(frozen=True, slots=True)
class AccountObservation:
    """Report one account's funding policy, creation time and total balances.

    Totals include reserved amounts; cash is in the quote asset and asset in the
    base asset of the exchange's instrument. Unlimited accounts may be negative.
    """

    account_id: str
    funding: Funding
    created_at: datetime
    cash: Decimal
    asset: Decimal


@dataclass(frozen=True, slots=True)
class OrderSnapshot:
    """Capture original quantity, distinct executed/open/removed quantities, and state."""

    order_id: str
    account_id: str
    instrument_id: str
    side: OrderSide
    quantity: Decimal
    filled_quantity: Decimal
    limit_price: Decimal | None
    status: OrderStatus
    accepted_at: datetime
    remaining_quantity: Decimal
    client_order_id: str | None = None
    cancelled_quantity: Decimal = Decimal(0)
    prevented_quantity: Decimal = Decimal(0)
    commit_version: int = 0
    time_in_force: TimeInForce = TimeInForce.GTC


@dataclass(frozen=True, slots=True)
class Fill:
    """Describe one execution of an owned order without exposing its counterparty."""

    fill_id: str
    trade_id: str
    order_id: str
    instrument_id: str
    side: OrderSide
    price: Decimal
    quantity: Decimal
    executed_at: datetime
    liquidity: Liquidity
    commit_version: int = 0


@dataclass(frozen=True, slots=True)
class SubmitOrderResult:
    """Group an accepted order snapshot with its associated executions."""

    order: OrderSnapshot
    fills: tuple[Fill, ...]
