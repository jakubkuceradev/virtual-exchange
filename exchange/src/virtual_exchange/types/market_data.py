"""Experimental market observations; contracts are not yet finalized."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class BookLevel:
    """Summarize price and aggregate quantity at one order-book level."""

    price: Decimal
    quantity: Decimal


@dataclass(frozen=True, slots=True)
class OrderBookSnapshot:
    """Capture both sides of an instrument's book at a known sequence."""

    instrument_id: str
    bids: tuple[BookLevel, ...]
    asks: tuple[BookLevel, ...]
    sequence: int
    observed_at: datetime


@dataclass(frozen=True, slots=True)
class Trade:
    """Describe a public execution without private account or order identifiers."""

    trade_id: str
    instrument_id: str
    price: Decimal
    quantity: Decimal
    executed_at: datetime


@dataclass(frozen=True, slots=True)
class Ticker:
    """Capture current quotes and the last trade, when available."""

    instrument_id: str
    best_bid: BookLevel | None
    best_ask: BookLevel | None
    last_trade: Trade | None
    observed_at: datetime
