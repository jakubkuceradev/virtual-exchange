"""Recent one-minute candles of public executions, maintained per commit.

Candles are derived state: rebuilt at startup from the most recent trades in the
store and then updated in constant time per committed trade, so serving them
never scans history. Only the most recent window is retained.
"""

from collections import deque
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from virtual_exchange.types import Candle, Trade

GRANULARITY_SECONDS = 60
CAPACITY = 300


def bucket_start(moment: datetime) -> datetime:
    """Start of the one-minute bucket containing moment, in UTC."""
    moment = moment.astimezone(UTC)
    return moment.replace(second=0, microsecond=0)


class CandleSeries:
    """The last CAPACITY one-minute buckets, ending at the newest execution."""

    def __init__(self) -> None:
        # Mutable [start, open, high, low, close, volume] rows, oldest first.
        self._rows: deque[list] = deque()
        self.through_trade_id: str | None = None

    @staticmethod
    def window_start(newest: datetime) -> datetime:
        """Earliest bucket start retained when the newest bucket starts at newest."""
        return bucket_start(newest) - timedelta(
            seconds=GRANULARITY_SECONDS * (CAPACITY - 1)
        )

    def add(self, trade: Trade) -> None:
        """Absorb one committed execution; executions arrive in trade-ID order."""
        start = bucket_start(trade.executed_at)
        price, quantity = trade.price, trade.quantity
        last = self._rows[-1] if self._rows else None
        if last is None or start > last[0]:
            self._rows.append([start, price, price, price, price, quantity])
            first = self.window_start(start)
            while self._rows[0][0] < first:
                self._rows.popleft()
        else:
            # Same bucket, or a clock step backwards: fold into the newest bucket
            # rather than rewriting earlier ones.
            last[2] = max(last[2], price)
            last[3] = min(last[3], price)
            last[4] = price
            last[5] += quantity
        self.through_trade_id = trade.trade_id

    def candles(
        self, *, start: datetime | None = None, end: datetime | None = None
    ) -> tuple[Candle, ...]:
        """Retained buckets whose start lies in [start, end), oldest first."""
        return tuple(
            Candle(row[0], row[1], row[2], row[3], row[4], Decimal(row[5]))
            for row in self._rows
            if (start is None or row[0] >= start) and (end is None or row[0] < end)
        )
