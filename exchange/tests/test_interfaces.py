"""Unimplemented public operations must never pretend to succeed."""

import pytest

from virtual_exchange import market_data


@pytest.mark.parametrize(
    ("operation", "arguments"),
    [
        (market_data.get_order_book, {"instrument_id": "ABC"}),
        (market_data.list_trades, {"instrument_id": "ABC"}),
        (market_data.get_ticker, {"instrument_id": "ABC"}),
    ],
)
def test_unimplemented_operations_fail_explicitly(operation, arguments):
    """Reject unimplemented operations instead of fabricating successful results."""
    with pytest.raises(NotImplementedError, match="not implemented"):
        operation(**arguments)
