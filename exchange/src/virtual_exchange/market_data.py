"""Public market-data interface placeholder; no market views are implemented.

Intended queries take an instrument and return public order-book snapshots,
recent trades, or ticker observations. Last-traded price can be unavailable;
observations will need explicit freshness/sequence and recovery contracts.

Consume committed exchange facts through its public boundary. Never expose
private account balances/orders as public market data or mutate exchange state.
Transport, streaming, retention, and concrete data schemas remain undecided.
"""

from collections.abc import Mapping, Sequence


def get_order_book(*, instrument_id: str) -> Mapping[str, object]:
    """Read a public book snapshot; not implemented.

    Depth and snapshot sequence/freshness contracts remain to be defined.
    """
    raise NotImplementedError("get_order_book is not implemented")


def list_trades(*, instrument_id: str) -> Sequence[Mapping[str, object]]:
    """Read public executions; history and pagination are deferred."""
    raise NotImplementedError("list_trades is not implemented")


def get_ticker(*, instrument_id: str) -> Mapping[str, object]:
    """Read public price observations; not implemented.

    No executions means no last-traded price; never substitute a fabricated zero.
    """
    raise NotImplementedError("get_ticker is not implemented")
