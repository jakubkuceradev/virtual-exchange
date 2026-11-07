"""Unimplemented public operations must never pretend to succeed."""

import pytest

from virtual_exchange import exchange, market_data


@pytest.mark.parametrize(
    ("operation", "arguments"),
    [
        (
            exchange.submit_order,
            {"account_id": "account", "request_id": "request", "order": {}},
        ),
        (
            exchange.cancel_order,
            {"account_id": "account", "request_id": "request", "order_id": "order"},
        ),
        (exchange.get_order, {"account_id": "account", "order_id": "order"}),
        (exchange.list_orders, {"account_id": "account"}),
        (exchange.list_fills, {"account_id": "account"}),
        (exchange.get_balances, {"account_id": "account"}),
        (exchange.list_instruments, {}),
        (market_data.get_order_book, {"instrument_id": "ABC"}),
        (market_data.list_trades, {"instrument_id": "ABC"}),
        (market_data.get_ticker, {"instrument_id": "ABC"}),
    ],
)
def test_unimplemented_operations_fail_explicitly(operation, arguments):
    """Reject unimplemented operations instead of fabricating successful results."""
    with pytest.raises(NotImplementedError, match="not implemented"):
        operation(**arguments)
