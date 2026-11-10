"""Exercise periods, marks and the competition core with synthetic time."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from pqc_website import periods
from pqc_website.competition import NO_FILLS, NOT_FUNDED, Competition, rank
from pqc_website.exchange_client import AccountRow
from pqc_website.marks import MarkWindow
from pqc_website.periods import Period
from pqc_website.store import Store

D = Decimal
TICK = timedelta(seconds=10)
# Monday 9 November 2026, 00:00 in Prague (CET, UTC+1).
WEEK = datetime(2026, 11, 8, 23, 0, tzinfo=UTC)
CREATED = datetime(2026, 11, 1, tzinfo=UTC)


def row(account, cash, asset="0", fills=0, funded=True, created=CREATED):
    return AccountRow(account, funded, created, D(cash), D(asset), fills)


def at(text):
    return datetime.fromisoformat(text)


# ---- Periods (criterion 5) ----


@pytest.mark.parametrize(
    "moment,start,end",
    [
        # Spring forward on Sunday 29 March 2026: a 167-hour week.
        ("2026-03-29T21:59:00+00:00", "2026-03-22T23:00:00+00:00", "2026-03-29T22:00:00+00:00"),
        ("2026-03-29T22:00:00+00:00", "2026-03-29T22:00:00+00:00", "2026-04-05T22:00:00+00:00"),
        # Fall back on Sunday 25 October 2026: a 169-hour week.
        ("2026-10-25T22:59:00+00:00", "2026-10-18T22:00:00+00:00", "2026-10-25T23:00:00+00:00"),
        ("2026-10-25T23:00:00+00:00", "2026-10-25T23:00:00+00:00", "2026-11-01T23:00:00+00:00"),
    ],
)  # fmt: skip
def test_weeks_follow_prague_across_daylight_saving(moment, start, end):
    begin = periods.start(Period.WEEKLY, at(moment))
    assert begin == at(start)
    assert periods.end(Period.WEEKLY, begin) == at(end)


def test_months_and_years_start_at_prague_midnight():
    moment = at("2026-07-15T12:00:00+00:00")
    assert periods.start(Period.MONTHLY, moment) == at("2026-06-30T22:00:00+00:00")
    assert periods.start(Period.YEARLY, moment) == at("2025-12-31T23:00:00+00:00")
    december = periods.start(Period.MONTHLY, at("2026-12-31T23:30:00+00:00"))
    assert december == at("2026-12-31T23:00:00+00:00")  # already 1 January local
    assert periods.end(Period.MONTHLY, at("2026-11-30T23:00:00+00:00")) == at(
        "2026-12-31T23:00:00+00:00"
    )
    assert periods.start(Period.CONTINUOUS, moment) is None


# ---- Marks (criterion 4) ----


def test_last_interval_push_moves_the_mark_by_at_most_one_thirtieth():
    boundary = WEEK
    window = MarkWindow()
    moment = boundary - timedelta(minutes=10)
    while moment < boundary - TICK:
        window.add(moment, D(100))
        moment += TICK
    # A large buy just before the boundary pushes the mid from 100 to 130.
    window.add(boundary - TICK, D(130))
    window.add(boundary, D(130))
    effect = window.mark(boundary) - D(100)
    assert D(0) < effect <= D(30) / 30


def test_mark_uses_trades_only_when_priced_and_is_none_without_prices():
    window = MarkWindow()
    window.add(WEEK, None)
    assert window.mark(WEEK + TICK) is None
    window.add(WEEK + TICK, D(50))
    assert window.mark(WEEK + TICK) == D(50)  # an instantaneous priced sample
    window.add(WEEK + 2 * TICK, None)
    assert window.mark(WEEK + 3 * TICK) == D(50)  # unpriced spans carry no weight


def test_ties_share_a_rank():
    ranked = rank([("a", D("0.1")), ("b", D("0.2")), ("c", D("0.1")), ("d", D(0))])
    assert [(r, a) for r, a, _ in ranked] == [(1, "b"), (2, "a"), (2, "c"), (4, "d")]


# ---- Competition ----


PRICE = D(100)


def run(competition, start, stop, accounts, price=PRICE):
    moment = start
    while moment <= stop:
        snapshot = competition.observe(moment, accounts, price)
        moment += TICK
    return snapshot


FIELD = [
    row("a", "1000"),
    row("b", "1000"),
    row("c", "0", funded=False),
    row("d", "1000"),
]
TRADED = [
    row("a", "1100", fills=1),
    row("b", "950", fills=1),
    row("c", "5000", "-40", fills=1, funded=False),
    row("d", "1000"),
]


def test_weekly_ranking_excludes_unlimited_and_idle_accounts():
    competition = Competition(Store.memory())
    run(competition, WEEK - timedelta(minutes=6), WEEK + TICK, FIELD)
    snapshot = run(competition, WEEK + 2 * TICK, WEEK + 3 * TICK, TRADED)
    weekly = snapshot.standings[Period.WEEKLY]
    assert [(r, a, ret) for r, a, ret in weekly.rows] == [
        (1, "a", D("0.1")),
        (2, "b", D("-0.05")),
    ]
    assert weekly.start == WEEK
    assert weekly.positions["c"].reason == NOT_FUNDED
    assert weekly.positions["d"].reason == NO_FILLS
    assert weekly.positions["d"].rank is None


def test_wednesday_joiner_is_baselined_at_creation():
    competition = Competition(Store.memory())
    run(competition, WEEK - timedelta(minutes=6), WEEK + TICK, FIELD)
    wednesday = WEEK + timedelta(days=2, hours=10)
    joiner = row("e", "500", created=wednesday)
    run(competition, wednesday, wednesday + TICK, [*FIELD, joiner])
    later = [*FIELD, row("e", "550", fills=2, created=wednesday)]
    snapshot = run(competition, wednesday + 2 * TICK, wednesday + 2 * TICK, later)
    weekly = snapshot.standings[Period.WEEKLY]
    assert weekly.positions["e"].ret == D("0.1")
    assert weekly.positions["e"].rank == 1
    baseline = competition._baselines[(Period.WEEKLY, WEEK)]["e"]
    assert (baseline.value, baseline.fill_count, baseline.at) == (
        D(500),
        0,
        wednesday,
    )


def test_boundary_freezes_standings_and_baselines_at_the_boundary(tmp_path):
    Store.create(tmp_path)
    competition = Competition(Store.open(tmp_path))
    previous = WEEK - timedelta(days=7)
    # Observed through the previous week's start and into it.
    run(competition, previous - timedelta(minutes=6), previous + TICK, FIELD)
    run(competition, WEEK - timedelta(minutes=6), WEEK - TICK, TRADED)
    moved = [row("a", "1210", fills=2), *TRADED[1:]]
    run(competition, WEEK, WEEK + TICK, moved)  # the tick at the boundary
    frozen = competition.store.frozen(Period.WEEKLY, previous)
    assert frozen.frozen_at == WEEK
    # The ended week is valued with the last observation before the boundary.
    assert frozen.rows == ((1, "a", D("0.1")), (2, "b", D("-0.05")))
    # The new week's baselines are those boundary values.
    new = competition._baselines[(Period.WEEKLY, WEEK)]
    assert (new["a"].value, new["a"].fill_count, new["a"].at) == (D(1100), 1, WEEK)
    competition.store.close()

    # Criterion 6: a restart keeps frozen standings and baselines.
    restarted = Competition(Store.open(tmp_path))
    assert restarted.store.frozen(Period.WEEKLY, previous) == frozen
    snapshot = restarted.observe(WEEK + 5 * TICK, moved, D(100))
    assert snapshot.standings[Period.WEEKLY].rows == ((1, "a", D("0.1")),)
    restarted.store.close()


def test_no_mark_means_no_valuation_and_series_points_every_ten_minutes():
    competition = Competition(Store.memory())
    snapshot = competition.observe(WEEK + TICK, FIELD, None)
    assert snapshot.mark is None
    assert snapshot.standings[Period.WEEKLY].rows == ()
    assert set(snapshot.values.values()) == {None}
    run(competition, WEEK + 2 * TICK, WEEK + timedelta(minutes=25), TRADED)
    points = competition.store.series("a", WEEK)
    assert [p for p, _ in points] == [
        WEEK + 2 * TICK,
        WEEK + timedelta(minutes=10),
        WEEK + timedelta(minutes=20),
    ]
    assert {v for _, v in points} == {D(1100)}


def test_failed_write_keeps_the_previous_state():
    store = Store.memory()
    competition = Competition(store)
    first = competition.observe(WEEK + TICK, TRADED, D(100))

    def broken(tick):
        raise OSError("disk full")

    store.write = broken
    with pytest.raises(OSError):
        competition.observe(WEEK + 2 * TICK, FIELD, D(200))
    assert competition.snapshot is first
    assert competition._marks.samples[-1] == (WEEK + TICK, D(100))


def test_store_lifecycle_and_online_backup(tmp_path, capsys):
    from pqc_website.admin import main as admin
    from pqc_website.store import StoreError

    state = tmp_path / "state"
    state.mkdir()
    with pytest.raises(StoreError, match="init-store"):
        Store.open(state)
    assert admin(["--state-dir", str(state), "init-store"]) == 0
    assert admin(["--state-dir", str(state), "init-store"]) == 1
    assert "already exists" in capsys.readouterr().err
    competition = Competition(Store.open(state))
    with pytest.raises(StoreError, match="Another website backend"):
        Store.open(state)
    previous = WEEK - timedelta(days=7)
    run(competition, previous - TICK, previous, FIELD)
    run(competition, WEEK - TICK, WEEK, TRADED)
    # Backup while the backend holds the store open.
    backup = tmp_path / "restore"
    backup.mkdir()
    destination = backup / "website.sqlite3"
    assert admin(["--state-dir", str(state), "backup-store", str(destination)]) == 0
    competition.store.close()
    restored = Competition(Store.open(backup))
    assert restored.store.frozen(Period.WEEKLY, previous).rows == (
        (1, "a", D("0.1")),
        (2, "b", D("-0.05")),
    )
    restored.store.close()
