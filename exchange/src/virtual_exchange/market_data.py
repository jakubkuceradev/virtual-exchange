"""Experimental market-data interface; unimplemented and not yet finalized."""

from virtual_exchange.types.market_data import (
    OrderBookSnapshot,
    Ticker,
    Trade,
)


def get_order_book(*, instrument_id: str) -> OrderBookSnapshot:
    """Read a public order-book snapshot; not implemented."""
    raise NotImplementedError("get_order_book is not implemented")


def list_trades(*, instrument_id: str) -> tuple[Trade, ...]:
    """List an instrument's public executions; not implemented."""
    raise NotImplementedError("list_trades is not implemented")


def get_ticker(*, instrument_id: str) -> Ticker:
    """Read current quotes and the optional last trade; not implemented."""
    raise NotImplementedError("get_ticker is not implemented")
