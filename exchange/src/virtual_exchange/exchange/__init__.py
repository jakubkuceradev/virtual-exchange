"""Public trading interface placeholder; no trading operations are implemented.

Intended commands accept authenticated identity and order intent to submit or
cancel an order. Queries expose that account's orders, fills, and balances, plus
instrument metadata. Results and errors must describe complete operations.

The exchange owns consistent trading state behind this boundary. Callers must
not coordinate matching, funding, settlement, or persistence themselves. Internal
structure and concrete data schemas are left for later slices.

This boundary knows nothing about competition periods, rankings, website code,
HTTP credentials, or private bot strategies.
"""

from collections.abc import Mapping, Sequence


def submit_order(
    *, account_id: str, request_id: str, order: Mapping[str, object]
) -> Mapping[str, object]:
    """Submit order intent as one complete operation; not implemented.

    The future result describes acceptance/rejection and any executions. It must
    coordinate trading effects durably before success. Request IDs will identify
    retries; order fields and retry rules remain to be specified.
    """
    raise NotImplementedError("submit_order is not implemented")


def cancel_order(
    *, account_id: str, request_id: str, order_id: str
) -> Mapping[str, object]:
    """Cancel an owned order's unfilled quantity; not implemented.

    Prior executions remain final. Unknown/not-owned orders and retries require
    explicit outcomes; no order is looked up or changed by this stub.
    """
    raise NotImplementedError("cancel_order is not implemented")


def get_order(*, account_id: str, order_id: str) -> Mapping[str, object]:
    """Read an owned order's state or report access/not-found failure; not implemented."""
    raise NotImplementedError("get_order is not implemented")


def list_orders(*, account_id: str) -> Sequence[Mapping[str, object]]:
    """Read the account's orders; filtering and pagination are deferred."""
    raise NotImplementedError("list_orders is not implemented")


def list_fills(*, account_id: str) -> Sequence[Mapping[str, object]]:
    """Read the account's executions; history and pagination are deferred."""
    raise NotImplementedError("list_fills is not implemented")


def get_balances(*, account_id: str) -> Sequence[Mapping[str, object]]:
    """Read owned asset balances, including availability/reservations; not implemented."""
    raise NotImplementedError("get_balances is not implemented")


def list_instruments() -> Sequence[Mapping[str, object]]:
    """Read instrument definitions and trading constraints; not implemented."""
    raise NotImplementedError("list_instruments is not implemented")
