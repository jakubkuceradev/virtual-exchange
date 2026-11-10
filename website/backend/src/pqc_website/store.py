"""Durable competition observations in one SQLite file.

The backend writes each sampling tick in one transaction: mark samples,
new baselines, frozen standings, series points and the latest observation.
Times are integer microseconds since the Unix epoch, so they sort and compare
exactly; amounts are decimal strings.
"""

import fcntl
import json
import os
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

FILENAME = "website.sqlite3"
LOCK_FILENAME = "website.lock"
SCHEMA_VERSION = 1
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECOND = timedelta(microseconds=1)

_SCHEMA = f"""
BEGIN;
CREATE TABLE state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    body TEXT NOT NULL
);
INSERT INTO state VALUES (1, '{{}}');
CREATE TABLE marks (at INTEGER PRIMARY KEY, price TEXT);
CREATE TABLE baselines (
    period TEXT NOT NULL,
    start INTEGER NOT NULL,  -- 0 for the continuous period
    account_id TEXT NOT NULL,
    value TEXT NOT NULL,
    fill_count INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (period, start, account_id)
) WITHOUT ROWID;
CREATE TABLE frozen (
    period TEXT NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    frozen_at INTEGER NOT NULL,
    rows TEXT NOT NULL,
    PRIMARY KEY (period, start)
) WITHOUT ROWID;
CREATE TABLE series (
    account_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (account_id, at)
) WITHOUT ROWID;
CREATE INDEX series_at ON series (at);
PRAGMA user_version = {SCHEMA_VERSION};
COMMIT;
"""


class StoreError(RuntimeError):
    """The store is missing, locked, incompatible, or failed."""


def micros(moment: datetime) -> int:
    return (moment - _EPOCH) // _MICROSECOND


def moment(value: int) -> datetime:
    return _EPOCH + value * _MICROSECOND


@dataclass(frozen=True, slots=True)
class Baseline:
    value: Decimal
    fill_count: int
    at: datetime


@dataclass(frozen=True, slots=True)
class Frozen:
    """Final standings of a finished period; rows are (rank, account, return)."""

    period: str
    start: datetime
    end: datetime
    frozen_at: datetime
    rows: tuple[tuple[int, str, Decimal], ...]


@dataclass(slots=True)
class Tick:
    """Everything one sampling tick writes."""

    state: dict
    mark: tuple[datetime, Decimal | None]
    prune_marks_before: datetime
    baselines: list[tuple[str, datetime | None, str, Baseline]] = field(
        default_factory=list
    )
    frozen: list[Frozen] = field(default_factory=list)
    series: list[tuple[str, datetime, Decimal]] = field(default_factory=list)
    prune_series_before: datetime | None = None


class Store:
    """Own the backend's SQLite file; one backend process writes it."""

    def __init__(self, connection: sqlite3.Connection, lock: int | None = None):
        self._db = connection
        self._lock = lock

    @staticmethod
    def path(directory: str | Path) -> Path:
        return Path(directory) / FILENAME

    @classmethod
    def create(cls, directory: str | Path) -> Path:
        """Initialise an empty store; an operator action, never automatic."""
        path = cls.path(directory)
        try:
            path.open("xb").close()
        except FileExistsError:
            raise StoreError(f"A website store already exists at {path}") from None
        except OSError as error:
            raise StoreError(f"Cannot create the website store: {error}") from None
        connection = sqlite3.connect(path, autocommit=True)
        try:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(_SCHEMA)
        finally:
            connection.close()
        return path

    @classmethod
    def open(cls, directory: str | Path) -> Store:
        """Open an initialised store and take the single-writer lock."""
        path = cls.path(directory)
        if not path.is_file():
            raise StoreError(
                f"No website store at {path}; initialise one with "
                "`python -m pqc_website.admin init-store`"
            )
        lock = os.open(Path(directory) / LOCK_FILENAME, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(lock)
            raise StoreError(f"Another website backend is using {path}") from None
        try:
            connection = sqlite3.connect(
                f"{path.resolve().as_uri()}?mode=rw",
                uri=True,
                autocommit=True,
                check_same_thread=False,
            )
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version != SCHEMA_VERSION:
                connection.close()
                raise StoreError(
                    f"The website store at {path} has schema version {version}; "
                    f"this backend needs version {SCHEMA_VERSION}"
                )
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = FULL")
            connection.execute("PRAGMA busy_timeout = 5000")
        except BaseException:
            os.close(lock)
            raise
        return cls(connection, lock)

    @classmethod
    def memory(cls) -> Store:
        """An ephemeral store for tests; nothing survives."""
        connection = sqlite3.connect(
            ":memory:", autocommit=True, check_same_thread=False
        )
        connection.executescript(_SCHEMA)
        return cls(connection)

    def close(self) -> None:
        self._db.close()
        if self._lock is not None:
            os.close(self._lock)
            self._lock = None

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        self._db.execute("BEGIN IMMEDIATE")
        try:
            yield self._db
        except BaseException:
            if self._db.in_transaction:
                self._db.execute("ROLLBACK")
            raise
        self._db.execute("COMMIT")

    # ---- Startup ----

    def state(self) -> dict:
        (body,) = self._db.execute("SELECT body FROM state").fetchone()
        return json.loads(body)

    def marks(self) -> tuple[tuple[datetime, Decimal | None], ...]:
        return tuple(
            (moment(at), None if price is None else Decimal(price))
            for at, price in self._db.execute("SELECT at, price FROM marks ORDER BY at")
        )

    def baselines(self, period: str, start: datetime | None) -> dict[str, Baseline]:
        return {
            account: Baseline(Decimal(value), fills, moment(at))
            for account, value, fills, at in self._db.execute(
                "SELECT account_id, value, fill_count, at FROM baselines "
                "WHERE period = ? AND start = ?",
                (period, 0 if start is None else micros(start)),
            )
        }

    # ---- Durable writes ----

    def write(self, tick: Tick) -> None:
        with self._transaction() as db:
            db.execute("UPDATE state SET body = ?", (json.dumps(tick.state),))
            at, price = tick.mark
            db.execute(
                "INSERT INTO marks VALUES (?, ?)",
                (micros(at), None if price is None else str(price)),
            )
            db.execute(
                "DELETE FROM marks WHERE at < ?", (micros(tick.prune_marks_before),)
            )
            db.executemany(
                "INSERT INTO baselines VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (
                        period,
                        0 if start is None else micros(start),
                        account,
                        str(b.value),
                        b.fill_count,
                        micros(b.at),
                    )
                    for period, start, account, b in tick.baselines
                ],
            )
            db.executemany(
                "INSERT INTO frozen VALUES (?, ?, ?, ?, ?)",
                [
                    (
                        f.period,
                        micros(f.start),
                        micros(f.end),
                        micros(f.frozen_at),
                        json.dumps(
                            [[rank, account, str(ret)] for rank, account, ret in f.rows]
                        ),
                    )
                    for f in tick.frozen
                ],
            )
            db.executemany(
                "INSERT INTO series VALUES (?, ?, ?)",
                [(a, micros(at), str(v)) for a, at, v in tick.series],
            )
            if tick.prune_series_before is not None:
                db.execute(
                    "DELETE FROM series WHERE at < ?",
                    (micros(tick.prune_series_before),),
                )

    # ---- Reads ----

    def frozen_list(self, period: str) -> tuple[Frozen, ...]:
        return tuple(
            self._frozen(row)
            for row in self._db.execute(
                "SELECT period, start, end, frozen_at, rows FROM frozen "
                "WHERE period = ? ORDER BY start DESC",
                (period,),
            )
        )

    def frozen(self, period: str, start: datetime) -> Frozen | None:
        row = self._db.execute(
            "SELECT period, start, end, frozen_at, rows FROM frozen "
            "WHERE period = ? AND start = ?",
            (period, micros(start)),
        ).fetchone()
        return None if row is None else self._frozen(row)

    @staticmethod
    def _frozen(row: Sequence) -> Frozen:
        period, start, end, frozen_at, rows = row
        return Frozen(
            period,
            moment(start),
            moment(end),
            moment(frozen_at),
            tuple(
                (rank, account, Decimal(ret)) for rank, account, ret in json.loads(rows)
            ),
        )

    def series(self, account: str, since: datetime) -> tuple[tuple[datetime, Decimal]]:
        return tuple(
            (moment(at), Decimal(value))
            for at, value in self._db.execute(
                "SELECT at, value FROM series WHERE account_id = ? AND at >= ? "
                "ORDER BY at",
                (account, micros(since)),
            )
        )

    @classmethod
    def backup(cls, directory: str | Path, destination: str | Path) -> None:
        """Copy one consistent committed state while the backend keeps running.

        Reads through a separate read-only connection, so it needs no lock.
        """
        path, destination = cls.path(directory), Path(destination)
        if not path.is_file():
            raise StoreError(f"No website store at {path}")
        if destination.exists():
            raise StoreError(f"{destination} already exists")
        connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            connection.execute("PRAGMA busy_timeout = 5000")
            connection.execute("VACUUM INTO ?", (str(destination),))
        finally:
            connection.close()
