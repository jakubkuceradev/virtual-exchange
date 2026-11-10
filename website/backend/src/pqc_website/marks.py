"""Time-weighted mark price over a trailing window of price samples."""

from collections.abc import Iterable
from datetime import datetime, timedelta
from decimal import Decimal, localcontext

WINDOW = timedelta(minutes=5)
PRECISION = 50  # significant digits for exact-input arithmetic
_MICROSECOND = timedelta(microseconds=1)


class MarkWindow:
    """Hold recent price samples and average them as a step function.

    Each sample's price holds until the next sample. Unpriced samples (no
    two-sided book and no trade yet) contribute no weight. A sample taken at
    the averaging moment itself has zero weight, so one sampling interval can
    move the mark by at most interval / WINDOW of its price change.
    """

    def __init__(self, samples: Iterable[tuple[datetime, Decimal | None]] = ()):
        self._samples: list[tuple[datetime, Decimal | None]] = sorted(samples)

    @property
    def samples(self) -> tuple[tuple[datetime, Decimal | None], ...]:
        return tuple(self._samples)

    def add(self, at: datetime, price: Decimal | None) -> None:
        if self._samples and at <= self._samples[-1][0]:
            raise ValueError("samples must advance in time")
        self._samples.append((at, price))

    def prune(self, before: datetime) -> None:
        """Drop samples no average from `before` onwards needs."""
        keep = 0
        for index, (at, _) in enumerate(self._samples):
            if at <= before - WINDOW:
                keep = index  # the latest sample at or before the window start
        del self._samples[:keep]

    def mark(self, at: datetime) -> Decimal | None:
        """Return the average over (at - WINDOW, at] from samples up to `at`."""
        begin = at - WINDOW
        known = [(t, p) for t, p in self._samples if t <= at]
        if not known:
            return None
        weighted = Decimal(0)
        weight = Decimal(0)
        with localcontext(prec=PRECISION):
            for index, (t, price) in enumerate(known):
                stop = known[index + 1][0] if index + 1 < len(known) else at
                left = max(t, begin)
                if price is None or stop <= left:
                    continue
                seconds = Decimal((stop - left) // _MICROSECOND)  # exact weight
                weighted += price * seconds
                weight += seconds
            if weight:
                return weighted / weight
        # Only an instantaneous sample at `at` is priced: use it.
        last_at, last = known[-1]
        return last if last_at > begin else None
