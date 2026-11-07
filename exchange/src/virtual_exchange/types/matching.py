"""Immutable internal matching outcomes for future account settlement."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from virtual_exchange.types.trading import OrderSnapshot


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
