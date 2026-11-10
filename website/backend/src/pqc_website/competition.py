"""Valuation, baselines, eligibility, rankings and history for the competition.

`Competition.observe` takes one sample of exchange facts (every account's
totals and fill count, and the instrument price) and is the only writer.
Everything it derives is persisted in one store transaction before memory
changes, so a failed write leaves the previous state intact for the next tick.
"""

import logging
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal, localcontext

from pqc_website import periods
from pqc_website.exchange_client import AccountRow
from pqc_website.marks import PRECISION, WINDOW, MarkWindow
from pqc_website.periods import CALENDAR, Period
from pqc_website.store import Baseline, Frozen, Store, Tick, micros, moment

_log = logging.getLogger(__name__)

TOLERANCE = timedelta(seconds=30)  # an observation this close counts as "at"
SERIES_INTERVAL = timedelta(minutes=10)
SERIES_RETENTION = timedelta(days=365)

NOT_FUNDED = "not_funded"
NO_FILLS = "no_fills"
NO_VALUATION = "no_valuation"


@dataclass(frozen=True, slots=True)
class Position:
    """A caller's place in one period; rank is None when unranked."""

    ret: Decimal | None
    rank: int | None
    reason: str | None
    baseline: Decimal | None  # the account's value at its period baseline


@dataclass(frozen=True, slots=True)
class Standings:
    period: Period
    start: datetime | None
    end: datetime | None
    rows: tuple[tuple[int, str, Decimal], ...]  # rank, account, return
    positions: dict[str, Position]


@dataclass(frozen=True, slots=True)
class Snapshot:
    computed_at: datetime
    mark: Decimal | None
    values: dict[str, Decimal | None]
    funded: dict[str, bool]
    standings: dict[Period, Standings]


@dataclass(frozen=True, slots=True)
class _Observation:
    at: datetime
    rows: dict[str, AccountRow]


def rank(entries: Iterable[tuple[str, Decimal]]) -> tuple[tuple[int, str, Decimal]]:
    """Order by return, highest first; equal returns share a rank (1, 2, 2, 4)."""
    ordered = sorted(entries, key=lambda entry: (-entry[1], entry[0]))
    result, previous, current = [], None, 0
    for index, (account, ret) in enumerate(ordered, start=1):
        if ret != previous:
            current, previous = index, ret
        result.append((current, account, ret))
    return tuple(result)


def _value(row: AccountRow, mark: Decimal | None) -> Decimal | None:
    if mark is None:
        return None
    with localcontext(prec=PRECISION):
        return row.cash + row.asset * mark


def _return(value: Decimal | None, baseline: Baseline | None) -> Decimal | None:
    if value is None or baseline is None or baseline.value <= 0:
        return None
    with localcontext(prec=PRECISION):
        return value / baseline.value - 1


class Competition:
    """Own the competition state; persist through `store` before applying."""

    def __init__(self, store: Store) -> None:
        self._store = store
        state = store.state()
        self._marks = MarkWindow(store.marks())
        self._starts: dict[Period, datetime] = {
            Period(kind): moment(at) for kind, at in state.get("starts", {}).items()
        }
        self._last: _Observation | None = None
        if "last" in state:
            self._last = _Observation(
                moment(state["last"]["at"]),
                {row[0]: _row(row) for row in state["last"]["rows"]},
            )
        self._series_slot: int | None = state.get("series_slot")
        self._baselines: dict[tuple[Period, datetime | None], dict[str, Baseline]] = {
            (Period.CONTINUOUS, None): store.baselines(Period.CONTINUOUS, None)
        }
        for kind, start in self._starts.items():
            self._baselines[(kind, start)] = store.baselines(kind, start)
        self.snapshot: Snapshot | None = None

    @property
    def store(self) -> Store:
        return self._store

    def observe(
        self, now: datetime, accounts: Iterable[AccountRow], price: Decimal | None
    ) -> Snapshot:
        """Record one sample; derive baselines, standings, freezes and series."""
        if self._last is not None and now <= self._last.at:
            raise ValueError("observations must advance in time")
        rows = {row.account_id: row for row in accounts}
        current = _Observation(now, rows)
        marks = MarkWindow(self._marks.samples)
        marks.add(now, price)
        # Keep what averages from one window ago need: boundary marks.
        marks.prune(now - WINDOW)
        mark = marks.mark(now)

        starts = dict(self._starts)
        baselines = {key: dict(value) for key, value in self._baselines.items()}
        tick = Tick({}, (now, price), marks.samples[0][0])

        for kind in CALENDAR:
            start = periods.start(kind, now)
            previous = starts.get(kind)
            if previous == start:
                continue
            baselines.setdefault((kind, start), {})
            starts[kind] = start
            if previous is None:
                continue  # first run: baselines come from the catch-up below
            at, observation, boundary_mark = self._boundary(start, current, marks)
            frozen_rows = self._standings(
                kind,
                previous,
                observation.rows,
                boundary_mark,
                baselines.pop((kind, previous), {}),
            ).rows
            tick.frozen.append(
                Frozen(kind, previous, periods.end(kind, previous), at, frozen_rows)
            )
            if boundary_mark is None:
                _log.warning("no mark at the %s boundary %s", kind, start)
                continue
            for account, row in observation.rows.items():
                if row.created_at < start:
                    baseline = Baseline(_value(row, boundary_mark), row.fill_count, at)
                    baselines[(kind, start)][account] = baseline
                    tick.baselines.append((kind, start, account, baseline))

        # Catch up baselines: late joiners, first runs and deferred boundaries.
        if mark is not None:
            for (kind, start), known in baselines.items():
                for account, row in rows.items():
                    if account in known:
                        continue
                    joined = start is None or row.created_at >= start
                    if joined and now - row.created_at > TOLERANCE:
                        _log.warning(
                            "%s baseline for %s set at first observation %s, "
                            "after creation %s",
                            kind,
                            account,
                            now,
                            row.created_at,
                        )
                    elif not joined:
                        _log.warning(
                            "%s baseline for %s set at %s, after the period start %s",
                            kind,
                            account,
                            now,
                            start,
                        )
                    baseline = Baseline(
                        _value(row, mark), 0 if joined else row.fill_count, now
                    )
                    known[account] = baseline
                    tick.baselines.append((kind, start, account, baseline))

        slot = micros(now) // (SERIES_INTERVAL // timedelta(microseconds=1))
        if mark is not None and slot != self._series_slot:
            tick.series = [(a, now, _value(row, mark)) for a, row in rows.items()]
            tick.prune_series_before = now - SERIES_RETENTION
            series_slot = slot
        else:
            series_slot = self._series_slot

        snapshot = Snapshot(
            now,
            mark,
            {account: _value(row, mark) for account, row in rows.items()},
            {account: row.funded for account, row in rows.items()},
            {
                kind: self._standings(kind, start, rows, mark, baselines[(kind, start)])
                for kind, start in [(Period.CONTINUOUS, None), *starts.items()]
            },
        )
        tick.state = {
            "starts": {kind: micros(start) for kind, start in starts.items()},
            "series_slot": series_slot,
            "last": {"at": micros(now), "rows": [_wire(row) for row in rows.values()]},
        }
        self._store.write(tick)

        self._marks = marks
        self._starts = starts
        self._baselines = baselines
        self._last = current
        self._series_slot = series_slot
        self.snapshot = snapshot
        return snapshot

    def _boundary(
        self, boundary: datetime, current: _Observation, marks: MarkWindow
    ) -> tuple[datetime, _Observation, Decimal | None]:
        """Choose the observation and mark that value accounts at a boundary."""
        last = self._last
        if last is not None and boundary - TOLERANCE <= last.at <= boundary:
            return boundary, last, marks.mark(boundary)
        _log.warning(
            "not observing at the boundary %s; using the observation at %s",
            boundary,
            current.at,
        )
        return current.at, current, marks.mark(current.at)

    @staticmethod
    def _standings(
        kind: Period,
        start: datetime | None,
        rows: dict[str, AccountRow],
        mark: Decimal | None,
        baselines: dict[str, Baseline],
    ) -> Standings:
        positions: dict[str, Position] = {}
        eligible: list[tuple[str, Decimal]] = []
        for account, row in rows.items():
            baseline = baselines.get(account)
            ret = _return(_value(row, mark), baseline)
            if not row.funded:
                reason = NOT_FUNDED
            elif ret is None:
                reason = NO_VALUATION
            elif row.fill_count <= baseline.fill_count:
                reason = NO_FILLS
            else:
                reason = None
                eligible.append((account, ret))
            value = None if baseline is None else baseline.value
            positions[account] = Position(ret, None, reason, value)
        ranked = rank(eligible)
        for position, account, _ in ranked:
            positions[account] = replace(positions[account], rank=position, reason=None)
        end = periods.end(kind, start) if start is not None else None
        return Standings(kind, start, end, ranked, positions)

    # ---- Reads ----

    def series(self, account: str) -> tuple[tuple[datetime, Decimal], ...]:
        if self.snapshot is None:
            return ()
        since = self.snapshot.computed_at - SERIES_RETENTION
        return self._store.series(account, since)


def _wire(row: AccountRow) -> list:
    return [
        row.account_id,
        row.funded,
        micros(row.created_at),
        str(row.cash),
        str(row.asset),
        row.fill_count,
    ]


def _row(wire: list) -> AccountRow:
    account, funded, created, cash, asset, fills = wire
    return AccountRow(
        account, funded, moment(created), Decimal(cash), Decimal(asset), fills
    )
