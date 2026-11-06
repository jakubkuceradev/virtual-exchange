"""Experimental trading interface; operations are unimplemented and not finalized."""

from collections.abc import Mapping

from virtual_exchange.types.trading import (
    Balance,
    Fill,
    Instrument,
    OrderSnapshot,
    SubmitOrderResult,
)


def submit_order(
    *, account_id: str, request_id: str, order: Mapping[str, object]
) -> SubmitOrderResult:
    """Submit an order as one coordinated trading operation; not implemented."""
    raise NotImplementedError("submit_order is not implemented")


def cancel_order(*, account_id: str, request_id: str, order_id: str) -> OrderSnapshot:
    """Cancel an owned order's unfilled quantity; not implemented."""
    raise NotImplementedError("cancel_order is not implemented")


def get_order(*, account_id: str, order_id: str) -> OrderSnapshot:
    """Read an owned order snapshot; not implemented."""
    raise NotImplementedError("get_order is not implemented")


def list_orders(*, account_id: str) -> tuple[OrderSnapshot, ...]:
    """List an account's orders; not implemented."""
    raise NotImplementedError("list_orders is not implemented")


def list_fills(*, account_id: str) -> tuple[Fill, ...]:
    """List an account's executions; not implemented."""
    raise NotImplementedError("list_fills is not implemented")


def get_balances(*, account_id: str) -> tuple[Balance, ...]:
    """Read an account's available and reserved asset balances; not implemented."""
    raise NotImplementedError("get_balances is not implemented")


def list_instruments() -> tuple[Instrument, ...]:
    """List supported instruments and trading constraints; not implemented."""
    raise NotImplementedError("list_instruments is not implemented")
