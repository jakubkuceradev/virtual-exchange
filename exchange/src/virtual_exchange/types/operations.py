"""Framework-independent requests, receipts, and consistent account observations."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from virtual_exchange.types.trading import (
    Balance,
    OrderSide,
    OrderSnapshot,
    TimeInForce,
)


@dataclass(frozen=True, slots=True)
class LimitOrder:
    instrument_id: str
    side: OrderSide
    price: Decimal
    quantity: Decimal
    client_order_id: str | None = None
    time_in_force: TimeInForce = TimeInForce.GTC


@dataclass(frozen=True, slots=True)
class Acceptance:
    order_id: str
    client_order_id: str | None
    accepted_at: datetime
    process_id: str


@dataclass(frozen=True, slots=True)
class Cancellation:
    order_id: str
    process_id: str
    commit_id: int


@dataclass(frozen=True, slots=True)
class AccountSnapshot:
    process_id: str
    commit_id: int
    balances: tuple[Balance, ...]
    orders: tuple[OrderSnapshot, ...]
    fill_high_watermark: int
    channel_baselines: tuple[tuple[str, int], ...]
