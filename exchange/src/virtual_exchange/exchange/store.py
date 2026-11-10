"""Durable exchange state in one SQLite file; the only owner of retained history.

The exchange writes each command's complete changes in one transaction and
keeps only the live book, balances and counters in memory. Rows carry the full
public record as a JSON body plus the columns that queries and constraints use;
every column is derived from the same record in the same statement.
"""

import fcntl
import json
import os
import sqlite3
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, fields
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from virtual_exchange.exchange.configuration import TradingConfigurationError
from virtual_exchange.types import (
    Fill,
    Funding,
    Instrument,
    Liquidity,
    NewsItem,
    OrderSide,
    OrderSnapshot,
    OrderStatus,
    TimeInForce,
    Trade,
)

FILENAME = "exchange.sqlite3"
LOCK_FILENAME = "exchange.lock"
SCHEMA_VERSION = 1
_TERMINAL = frozenset({OrderStatus.FILLED, OrderStatus.CANCELLED})

_SCHEMA = f"""
BEGIN;
CREATE TABLE state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    instrument TEXT,
    commit_id INTEGER NOT NULL
);
INSERT INTO state VALUES (1, NULL, 0);
CREATE TABLE accounts (
    account_id TEXT PRIMARY KEY,
    cash INTEGER NOT NULL,
    asset INTEGER NOT NULL,
    funding TEXT NOT NULL,
    order_count INTEGER NOT NULL DEFAULT 0,
    fill_count INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE TABLE orders (
    order_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_seq INTEGER NOT NULL,
    priority INTEGER NOT NULL,
    client_order_id TEXT,
    filled INTEGER NOT NULL,
    terminal_at REAL,
    body TEXT NOT NULL,
    UNIQUE (account_id, account_seq),
    UNIQUE (account_id, client_order_id)
);
CREATE INDEX orders_open ON orders (priority) WHERE terminal_at IS NULL;
CREATE INDEX orders_prunable ON orders (terminal_at)
    WHERE terminal_at IS NOT NULL AND filled = 0;
CREATE TABLE fills (
    account_id TEXT NOT NULL,
    account_seq INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (account_id, account_seq)
) WITHOUT ROWID;
CREATE TABLE trades (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE news (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
PRAGMA user_version = {SCHEMA_VERSION};
COMMIT;
"""


class StoreError(RuntimeError):
    """The store is missing, locked, incompatible, or failed to write."""


class StoreConflict(TradingConfigurationError):
    """Configuration conflicts with persisted state; nothing was written."""


@dataclass(frozen=True, slots=True)
class Recovered:
    """Everything memory needs after startup; history stays in the store."""

    commit_id: int
    accounts: dict[str, tuple[int, int, Funding]]
    open_orders: tuple[OrderSnapshot, ...]
    trades: int
    news: int


def _plain(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, tuple):
        return [_plain(item) for item in value]
    return value


def _encode(record) -> str:
    return json.dumps(
        {field.name: _plain(getattr(record, field.name)) for field in fields(record)},
        separators=(",", ":"),
    )


def _optional(convert: Callable) -> Callable:
    return lambda value: None if value is None else convert(value)


_DECIMAL_FIELDS = {
    "quantity",
    "filled_quantity",
    "remaining_quantity",
    "cancelled_quantity",
    "prevented_quantity",
    "price",
}
_CONVERTERS: dict[str, Callable] = {
    **dict.fromkeys(_DECIMAL_FIELDS, Decimal),
    "limit_price": _optional(Decimal),
    "accepted_at": datetime.fromisoformat,
    "executed_at": datetime.fromisoformat,
    "published_at": datetime.fromisoformat,
    "event_at": _optional(datetime.fromisoformat),
    "side": OrderSide,
    "status": OrderStatus,
    "time_in_force": TimeInForce,
    "liquidity": Liquidity,
    "instrument_ids": tuple,
}


def _decode[T](kind: type[T], body: str) -> T:
    values = json.loads(body)
    return kind(
        **{
            name: _CONVERTERS.get(name, lambda value: value)(value)
            for name, value in values.items()
        }
    )


def _instrument(body: str) -> Instrument:
    values = json.loads(body)
    return Instrument(
        **{
            **values,
            "price_increment": Decimal(values["price_increment"]),
            "quantity_increment": Decimal(values["quantity_increment"]),
        }
    )


class Store:
    """Own one exchange's SQLite file; a single exchange process writes it.

    The exchange lock serializes every call, so one connection may move between
    the threads a server or test client runs the event loop on.
    """

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
            raise StoreError(f"An exchange store already exists at {path}") from None
        except OSError as error:
            raise StoreError(f"Cannot create the exchange store: {error}") from None
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
                f"No exchange store at {path}; initialise one with "
                "`python -m virtual_exchange.admin init-store`"
            )
        lock = os.open(Path(directory) / LOCK_FILENAME, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(lock)
            raise StoreError(f"Another exchange process is using {path}") from None
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
                    f"The exchange store at {path} has schema version {version}; "
                    f"this exchange needs version {SCHEMA_VERSION}"
                )
            connection.execute("PRAGMA journal_mode = WAL")
            # FULL syncs the WAL on every commit: acknowledged means on disk.
            connection.execute("PRAGMA synchronous = FULL")
            connection.execute("PRAGMA busy_timeout = 5000")
        except BaseException:
            os.close(lock)
            raise
        return cls(connection, lock)

    @classmethod
    def memory(cls) -> Store:
        """An ephemeral store for tests and embedded use; nothing survives."""
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
            # Autocommit connections end transactions only through SQL.
            if self._db.in_transaction:
                self._db.execute("ROLLBACK")
            raise
        self._db.execute("COMMIT")

    # ---- Startup ----

    def adopt(
        self,
        instrument: Instrument,
        accounts: Mapping[str, tuple[int, int, Funding]],
    ) -> Recovered:
        """Apply configuration to the store, or refuse without writing.

        An empty store records the instrument and every account. Later starts
        keep persisted balances, add only new accounts and refuse a changed
        instrument or a changed funding policy for an existing account.
        """
        with self._transaction() as db:
            (stored,) = db.execute("SELECT instrument FROM state").fetchone()
            if stored is None:
                db.execute("UPDATE state SET instrument = ?", (_encode(instrument),))
            else:
                persisted = _instrument(stored)
                for field in fields(Instrument):
                    if getattr(persisted, field.name) != getattr(
                        instrument, field.name
                    ):
                        raise StoreConflict(
                            "Trading configuration conflicts with the exchange "
                            f"store: instrument {field.name} changed from "
                            f"{getattr(persisted, field.name)} to "
                            f"{getattr(instrument, field.name)}"
                        )
            funding = dict(db.execute("SELECT account_id, funding FROM accounts"))
            for account, (_, _, policy) in sorted(accounts.items()):
                if account in funding and funding[account] != policy:
                    raise StoreConflict(
                        "Trading configuration conflicts with the exchange store: "
                        f"funding for account {account!r} changed from "
                        f"{funding[account]} to {policy}"
                    )
            db.executemany(
                "INSERT INTO accounts (account_id, cash, asset, funding) "
                "VALUES (?, ?, ?, ?)",
                [
                    (account, cash, asset, str(policy))
                    for account, (cash, asset, policy) in accounts.items()
                    if account not in funding
                ],
            )
        return self._recover()

    def _recover(self) -> Recovered:
        db = self._db
        (commit_id,) = db.execute("SELECT commit_id FROM state").fetchone()
        return Recovered(
            commit_id,
            {
                account: (cash, asset, Funding(funding))
                for account, cash, asset, funding in db.execute(
                    "SELECT account_id, cash, asset, funding FROM accounts"
                )
            },
            tuple(
                _decode(OrderSnapshot, body)
                for (body,) in db.execute(
                    "SELECT body FROM orders WHERE terminal_at IS NULL "
                    "ORDER BY priority"
                )
            ),
            db.execute("SELECT coalesce(max(seq), 0) FROM trades").fetchone()[0],
            db.execute("SELECT coalesce(max(seq), 0) FROM news").fetchone()[0],
        )

    # ---- Durable writes ----

    def commit(
        self,
        *,
        commit_id: int,
        new_order_id: str | None,
        orders: Iterable[OrderSnapshot],
        fills: Mapping[str, Sequence[Fill]],
        trades: Sequence[Trade],
        balances: Mapping[str, tuple[int, int]],
        at: float,
    ) -> None:
        """Make one command's complete changes durable, or none of them."""
        with self._transaction() as db:
            db.execute("UPDATE state SET commit_id = ?", (commit_id,))
            for order in orders:
                terminal_at = at if order.status in _TERMINAL else None
                filled = int(order.filled_quantity > 0)
                if order.order_id == new_order_id:
                    (seq,) = db.execute(
                        "UPDATE accounts SET order_count = order_count + 1 "
                        "WHERE account_id = ? RETURNING order_count",
                        (order.account_id,),
                    ).fetchone()
                    db.execute(
                        "INSERT INTO orders (order_id, account_id, account_seq, "
                        "priority, client_order_id, filled, terminal_at, body) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            order.order_id,
                            order.account_id,
                            seq,
                            commit_id,
                            order.client_order_id,
                            filled,
                            terminal_at,
                            _encode(order),
                        ),
                    )
                elif (
                    db.execute(
                        "UPDATE orders SET filled = ?, terminal_at = ?, body = ? "
                        "WHERE order_id = ?",
                        (filled, terminal_at, _encode(order), order.order_id),
                    ).rowcount
                    != 1
                ):
                    raise StoreError("a changed order is missing from the store")
            for account, owned in fills.items():
                (count,) = db.execute(
                    "UPDATE accounts SET fill_count = fill_count + ? "
                    "WHERE account_id = ? RETURNING fill_count",
                    (len(owned), account),
                ).fetchone()
                start = count - len(owned)
                db.executemany(
                    "INSERT INTO fills VALUES (?, ?, ?)",
                    [
                        (account, start + offset, _encode(fill))
                        for offset, fill in enumerate(owned, 1)
                    ],
                )
            db.executemany(
                "INSERT INTO trades VALUES (?, ?)",
                [(int(trade.trade_id), _encode(trade)) for trade in trades],
            )
            db.executemany(
                "UPDATE accounts SET cash = ?, asset = ? WHERE account_id = ?",
                [(cash, asset, account) for account, (cash, asset) in balances.items()],
            )

    def prune(self, *, before: float, limit: int) -> int:
        """Delete up to limit zero-fill terminal orders finished before a time."""
        with self._transaction() as db:
            return db.execute(
                "DELETE FROM orders WHERE order_id IN (SELECT order_id FROM orders "
                "WHERE terminal_at IS NOT NULL AND filled = 0 AND terminal_at < ? "
                "LIMIT ?)",
                (before, limit),
            ).rowcount

    def append_news(self, seq: int, item: NewsItem) -> None:
        with self._transaction() as db:
            db.execute("INSERT INTO news VALUES (?, ?)", (seq, _encode(item)))

    # ---- History queries: each is a key lookup or an index range ----

    def order(self, order_id: str) -> OrderSnapshot | None:
        row = self._db.execute(
            "SELECT body FROM orders WHERE order_id = ?", (order_id,)
        ).fetchone()
        return row and _decode(OrderSnapshot, row[0])

    def client_order(self, account: str, client_order_id: str) -> OrderSnapshot | None:
        row = self._db.execute(
            "SELECT body FROM orders WHERE account_id = ? AND client_order_id = ?",
            (account, client_order_id),
        ).fetchone()
        return row and _decode(OrderSnapshot, row[0])

    def account_orders(self, account: str) -> tuple[OrderSnapshot, ...]:
        return tuple(
            _decode(OrderSnapshot, body)
            for (body,) in self._db.execute(
                "SELECT body FROM orders WHERE account_id = ? ORDER BY account_seq",
                (account,),
            )
        )

    def counts(self, account: str) -> tuple[int, int]:
        """Return the account's order and fill ordinals (their high watermarks)."""
        return self._db.execute(
            "SELECT order_count, fill_count FROM accounts WHERE account_id = ?",
            (account,),
        ).fetchone()

    def orders_between(
        self, account: str, start: int, stop: int
    ) -> tuple[OrderSnapshot, ...]:
        """Orders with start < ordinal <= stop; pruned ordinals leave gaps."""
        return self._range(
            OrderSnapshot,
            "SELECT body FROM orders WHERE account_id = ? "
            "AND account_seq > ? AND account_seq <= ? ORDER BY account_seq",
            (account, start, stop),
        )

    def fills_between(self, account: str, start: int, stop: int) -> tuple[Fill, ...]:
        return self._range(
            Fill,
            "SELECT body FROM fills WHERE account_id = ? "
            "AND account_seq > ? AND account_seq <= ? ORDER BY account_seq",
            (account, start, stop),
        )

    def trades_between(self, start: int, stop: int) -> tuple[Trade, ...]:
        return self._range(
            Trade,
            "SELECT body FROM trades WHERE seq > ? AND seq <= ? ORDER BY seq",
            (start, stop),
        )

    def news_between(self, start: int, stop: int) -> tuple[NewsItem, ...]:
        return self._range(
            NewsItem,
            "SELECT body FROM news WHERE seq > ? AND seq <= ? ORDER BY seq",
            (start, stop),
        )

    def _range[T](self, kind: type[T], query: str, parameters: tuple) -> tuple[T, ...]:
        return tuple(
            _decode(kind, body) for (body,) in self._db.execute(query, parameters)
        )
