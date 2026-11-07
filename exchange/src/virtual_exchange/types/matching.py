"""Immutable internal matching outcomes for future account settlement."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from virtual_exchange.types.trading import OrderSnapshot


class CancellationReason(StrEnum):
    """Explain why an accepted order's remainder was cancelled."""

    REQUESTED = "requested"
    SELF_TRADE = "self_trade"


@dataclass(frozen=True, slots=True)
class Execution:
    """Identify both sides of one matching execution."""

    execution_id: str
    instrument_id: str
    maker_order_id: str
    taker_order_id: str
    price: Decimal
    quantity: Decimal
    executed_at: datetime


@dataclass(frozen=True, slots=True)
class MatchingResult:
    """Describe one command and all resting orders it changed."""

    order: OrderSnapshot
    changed_resting_orders: tuple[OrderSnapshot, ...] = ()
    executions: tuple[Execution, ...] = ()
    cancellation_reason: CancellationReason | None = None
