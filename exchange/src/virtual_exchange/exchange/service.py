"""Complete funded operations with private candidate state and durable commits.

Each command builds a private candidate, writes its changes to the store in one
transaction, then applies them to memory and only then delivers observations.
Memory keeps the live book, balances and counters; history lives in the store.
"""

import asyncio
import base64
import hmac
import json
import logging
import time
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

from virtual_exchange.amounts import Amounts, OrderRejected, decimal
from virtual_exchange.auth import require_permission
from virtual_exchange.exchange.configuration import (
    TradingConfigurationError,
    load_config,
)
from virtual_exchange.exchange.ledger import Ledger
from virtual_exchange.exchange.matching import MatchingEngine, OrderNotFound
from virtual_exchange.exchange.news import NewsRejected, NewsRules
from virtual_exchange.exchange.observations import Subscription, frames
from virtual_exchange.exchange.store import (
    Recovered,
    Store,
    StoreConflict,
    StoreError,
)
from virtual_exchange.types import (
    Acceptance,
    AccountObservation,
    AccountSnapshot,
    AuthenticatedIdentity,
    Balance,
    Cancellation,
    Execution,
    Fill,
    Funding,
    Instrument,
    LimitOrder,
    Liquidity,
    NewsDraft,
    NewsItem,
    OrderBookSnapshot,
    OrderSide,
    OrderSnapshot,
    OrderStatus,
    Permission,
    Trade,
)

_log = logging.getLogger(__name__)


class TradingError(ValueError):
    """Expose a stable rejection code without private resource details."""

    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(slots=True)
class _State:
    """Committed in-memory state: the live book, balances and counters only."""

    engine: MatchingEngine
    ledger: Ledger
    channels: dict[tuple[str, str], int]
    sequence: int = 0

    def apply(self, candidate: _Candidate) -> None:
        """Absorb a durably committed candidate; only container updates remain."""
        if candidate.base is not self or candidate.sequence != self.sequence + 1:
            raise RuntimeError("candidate does not extend the current state")
        self.engine.commit(candidate.engine)
        self.ledger = candidate.ledger
        self.channels.update(candidate.channels)
        self.sequence = candidate.sequence


@dataclass(slots=True)
class _Candidate:
    """One command's private changes; discarded unless the whole command succeeds.

    History stays in the store, so the cost of a command depends on open orders,
    accounts and its own changes only.
    """

    base: _State
    engine: MatchingEngine
    ledger: Ledger
    sequence: int
    orders: dict[str, OrderSnapshot] = field(default_factory=dict)
    fills: dict[str, list[Fill]] = field(default_factory=dict)
    channels: dict[tuple[str, str], int] = field(default_factory=dict)
    executions: tuple[Execution, ...] = ()
    new_order_id: str | None = None

    @classmethod
    def of(cls, base: _State) -> _Candidate:
        return cls(base, base.engine.fork(), base.ledger.fork(), base.sequence + 1)

    def channel(self, key: tuple[str, str]) -> int:
        return self.channels.get(key, self.base.channels.get(key, 0))


class Exchange:
    """Serialize complete trading operations; expose only consistent observations."""

    def __init__(
        self,
        *,
        instrument: Instrument,
        allocations: Mapping[str, tuple[Decimal, Decimal]],
        funding: Mapping[str, Funding] | None = None,
        store: Store | None = None,
        on_store_failure: Callable[[], None] | None = None,
    ) -> None:
        """Recover persisted state, applying configuration only where it is new.

        Accounts absent from funding are funded; only operators assign policy.
        Without a store, state lives in an ephemeral in-memory database. A
        failed durable write leaves the exchange unavailable and calls
        on_store_failure, which should end the process so recovery can run.
        The exchange owns the store and closes it if construction fails.
        """
        self._store = Store.memory() if store is None else store
        try:
            engine, ledger, recovered = self._recover(instrument, allocations, funding)
        except BaseException:
            self._store.close()
            raise
        self.process_id = str(uuid4())
        self._subscribers: set[Subscription] = set()
        self._cursor_key = uuid4().bytes
        self._lock = asyncio.Lock()
        self._news = NewsRules(instrument_ids={instrument.instrument_id})
        self._news_count = recovered.news
        self._failed = False
        self._on_store_failure = on_store_failure
        self._state = _State(engine, ledger, {}, recovered.commit_id)
        # Accounts appear only at startup, so their directory is fixed here.
        self._directory = {
            account: (policy, created_at)
            for account, (_, _, policy, created_at) in sorted(
                recovered.accounts.items()
            )
        }

    def _recover(
        self,
        instrument: Instrument,
        allocations: Mapping[str, tuple[Decimal, Decimal]],
        funding: Mapping[str, Funding] | None,
    ) -> tuple[MatchingEngine, Ledger, Recovered]:
        """Validate configuration, apply it to the store and rebuild memory."""
        self.amounts = Amounts(instrument)
        values = {}
        for account, (cash, asset) in allocations.items():
            if not isinstance(account, str) or not account:
                raise OrderRejected("account ID must be a nonempty string")
            values[account] = (
                self.amounts.allocation(cash, cash=True),
                self.amounts.allocation(asset, cash=False),
            )
        funding = dict(funding or {})
        if not set(funding) <= set(values) or any(
            not isinstance(policy, Funding) for policy in funding.values()
        ):
            raise OrderRejected("funding must assign a Funding to allocated accounts")
        recovered = self._store.adopt(
            instrument,
            {
                account: (cash, asset, funding.get(account, Funding.FUNDED))
                for account, (cash, asset) in values.items()
            },
        )
        try:
            engine = MatchingEngine(
                instrument=instrument,
                open_orders=recovered.open_orders,
                sequence=recovered.commit_id,
                executions=recovered.trades,
            )
            ledger = Ledger(
                {
                    account: (cash, asset)
                    for account, (cash, asset, *_) in recovered.accounts.items()
                },
                frozenset(
                    account
                    for account, (_, _, policy, _) in recovered.accounts.items()
                    if policy == Funding.UNLIMITED
                ),
            )
            # Holds are derived from open orders; this also rejects a store
            # whose balances cannot support its resting orders.
            ledger.reconcile(engine.list_open_orders(), self.amounts)
        except (ValueError, ArithmeticError, RuntimeError, KeyError) as error:
            raise StoreError("The exchange store is inconsistent") from error
        return engine, ledger, recovered

    @classmethod
    def from_config(
        cls,
        *,
        path: str | Path,
        state_dir: str | Path,
        on_store_failure: Callable[[], None] | None = None,
    ) -> Exchange:
        """Load configuration, then recover the store in state_dir."""
        instrument, allocations, funding = load_config(path)
        try:
            return cls(
                instrument=instrument,
                allocations=allocations,
                funding=funding,
                store=Store.open(state_dir),
                on_store_failure=on_store_failure,
            )
        except StoreConflict:
            raise
        except ValueError, ArithmeticError, TypeError:
            raise TradingConfigurationError("Invalid trading configuration") from None

    def close(self) -> None:
        """Release the store; the instance must not be used afterwards."""
        self._failed = True
        self._store.close()

    @asynccontextmanager
    async def _locked(self) -> AsyncIterator[None]:
        async with self._lock:
            if self._failed:
                raise TradingError("trading_unavailable", 503)
            yield

    def _durably(self, write: Callable[[], None]) -> None:
        """Run a store write; any failure stops the exchange for recovery.

        After a failed commit the outcome on disk is unknown, so memory must not
        continue from either guess. Recovery on the next start reads the truth.
        """
        try:
            write()
        except Exception:
            self._failed = True
            _log.exception("exchange store write failed; trading stopped")
            if self._on_store_failure is not None:
                self._on_store_failure()
            raise TradingError("trading_unavailable", 503) from None

    def _account(self, identity: AuthenticatedIdentity, permission: Permission) -> str:
        require_permission(identity=identity, permission=permission)
        if identity.account_id not in self._state.ledger.total:
            raise TradingError("account_not_provisioned", 403)
        return identity.account_id

    @staticmethod
    def _client_id(value: str | None) -> None:
        if value is not None:
            try:
                parsed = UUID(value)
                if parsed.version != 4 or str(parsed) != value:
                    raise ValueError
            except ValueError, TypeError, AttributeError:
                raise TradingError("invalid_client_id") from None

    def _owned(self, account: str, order_id: str) -> OrderSnapshot:
        if order_id.startswith("client:"):
            order = self._store.client_order(account, order_id[7:])
        else:
            order = self._store.order(order_id)
        if order is None or order.account_id != account:
            raise TradingError("order_not_found", 404)
        return order

    async def submit_order(
        self, *, identity: AuthenticatedIdentity, order: LimitOrder
    ) -> Acceptance:
        async with self._locked():
            account = self._account(identity, Permission.TRADE)
            if order.instrument_id != self.amounts.instrument.instrument_id:
                raise TradingError("invalid_instrument")
            self._client_id(order.client_order_id)
            ticks, lots = self.amounts.order(
                side=order.side, price=order.price, quantity=order.quantity
            )
            if (
                order.client_order_id is not None
                and self._store.client_order(account, order.client_order_id) is not None
            ):
                raise TradingError("duplicate_client_id", 409)
            candidate = _Candidate.of(self._state)
            candidate.ledger.reserve(account, order.side, ticks, lots)
            result = candidate.engine.submit(
                account_id=account,
                side=order.side,
                price=order.price,
                quantity=order.quantity,
                client_order_id=order.client_order_id,
                time_in_force=order.time_in_force,
            )
            candidate.executions = result.executions
            candidate.new_order_id = result.order.order_id
            for snapshot in (*result.changed_resting_orders, result.order):
                candidate.orders[snapshot.order_id] = replace(
                    snapshot, commit_version=candidate.sequence
                )
            for execution in result.executions:
                maker = candidate.orders[execution.maker_order_id]
                taker = candidate.orders[execution.taker_order_id]
                candidate.ledger.settle(execution, maker, taker, self.amounts)
                for snapshot, liquidity in (
                    (maker, Liquidity.MAKER),
                    (taker, Liquidity.TAKER),
                ):
                    fill = Fill(
                        f"{execution.execution_id}:{snapshot.order_id}",
                        execution.execution_id,
                        snapshot.order_id,
                        execution.instrument_id,
                        snapshot.side,
                        execution.price,
                        execution.quantity,
                        execution.executed_at,
                        liquidity,
                        candidate.sequence,
                    )
                    candidate.fills.setdefault(snapshot.account_id, []).append(fill)
            candidate.ledger.reconcile(
                candidate.engine.list_open_orders(), self.amounts
            )
            receipt = Acceptance(
                result.order.order_id,
                order.client_order_id,
                result.order.accepted_at,
                self.process_id,
            )
            self._commit(candidate)
            return receipt

    def _prepare_observations(
        self, candidate: _Candidate
    ) -> tuple[tuple[str, str, tuple[str, ...]], ...]:
        old, new = candidate.base.engine, candidate.engine
        # Only price levels of orders this command changed can differ.
        touched: dict[str, set[Decimal]] = {"buy": set(), "sell": set()}
        for snapshot in candidate.orders.values():
            touched[snapshot.side].add(snapshot.limit_price)
        changes = []
        for side, prices in touched.items():
            for price in sorted(prices, reverse=side == "buy"):
                before = old.get_level(side=OrderSide(side), price=price)
                after = new.get_level(side=OrderSide(side), price=price)
                if before != after:
                    changes.append({"side": side, "price": price, "quantity": after})
        payloads = []
        if changes:
            payloads.append(("book", "", changes))
        if candidate.executions:
            payloads.append(
                ("trades", "", tuple(_trade(e) for e in candidate.executions))
            )
        changed: dict[str, list[OrderSnapshot]] = {}
        for snapshot in candidate.orders.values():
            changed.setdefault(snapshot.account_id, []).append(snapshot)
        for account in candidate.ledger.total:
            if orders := changed.get(account):
                payloads.append(("orders", account, tuple(orders)))
            if fills := candidate.fills.get(account):
                payloads.append(("fills", account, tuple(fills)))
        bundles = []
        for channel, account, payload in payloads:
            key = channel, account
            sequence = candidate.channel(key) + 1
            candidate.channels[key] = sequence
            bundles.append(
                (
                    channel,
                    account,
                    frames(
                        process_id=self.process_id,
                        channel=channel,
                        sequence=sequence,
                        commit_id=candidate.sequence,
                        kind="update",
                        payload=payload,
                    ),
                )
            )
        return tuple(bundles)

    def _commit(self, candidate: _Candidate) -> None:
        # Encoding can fail and must happen before any authoritative mutation.
        bundles = self._prepare_observations(candidate)
        # Durable before memory, memory before delivery: nothing awaits between
        # them, so no observation or response describes an unwritten commit.
        self._durably(
            lambda: self._store.commit(
                commit_id=candidate.sequence,
                new_order_id=candidate.new_order_id,
                orders=candidate.orders.values(),
                fills=candidate.fills,
                trades=tuple(_trade(e) for e in candidate.executions),
                balances={
                    account: candidate.ledger.total[account]
                    for account in candidate.fills
                },
                at=time.time(),
            )
        )
        self._state.apply(candidate)
        self._deliver(bundles)

    def _deliver(self, bundles: tuple[tuple[str, str, tuple[str, ...]], ...]) -> None:
        """Offer committed bundles to matching subscribers; never fails a command."""
        for subscription in self._subscribers:
            messages = tuple(
                message
                for channel, account, batch in bundles
                if channel in subscription.channels
                and (not account or account == subscription.account_id)
                for message in batch
            )
            subscription.offer(messages)

    async def subscribe(
        self, *, channels: frozenset[str], identity: AuthenticatedIdentity | None = None
    ) -> Subscription:
        async with self._locked():
            if not channels or not channels <= _CHANNELS:
                raise TradingError("invalid_channels")
            account = None
            if channels & {"orders", "fills"}:
                if identity is None:
                    raise TradingError("authentication_required", 401)
                account = self._account(identity, Permission.READ)
            baselines = self._channel_baselines(channels, account)
            initial = list(
                frames(
                    process_id=self.process_id,
                    channel="control",
                    sequence=0,
                    commit_id=self._state.sequence,
                    kind="subscribed",
                    payload={"channels": baselines},
                )
            )
            if "book" in channels:
                book = self._state.engine.get_order_book()
                for kind, payload in (
                    ("snapshot_start", {}),
                    ("snapshot", {"bids": book.bids, "asks": book.asks}),
                    ("snapshot_end", {}),
                ):
                    initial.extend(
                        frames(
                            process_id=self.process_id,
                            channel="book",
                            sequence=baselines["book"],
                            commit_id=self._state.sequence,
                            kind=kind,
                            payload=payload,
                        )
                    )
            subscription = Subscription(channels, account, tuple(initial))
            self._subscribers.add(subscription)
            return subscription

    def _channel_baselines(
        self, channels: frozenset[str], account: str | None
    ) -> dict[str, int]:
        """Report the last delivered sequence of each channel a subscriber sees."""
        return {
            channel: self._news_count
            if channel == "news"
            else self._state.channels.get(
                (channel, account if channel in {"orders", "fills"} else ""), 0
            )
            for channel in sorted(channels)
        }

    async def unsubscribe(self, subscription: Subscription) -> None:
        async with self._lock:
            self._subscribers.discard(subscription)

    async def heartbeat(self, subscription: Subscription) -> None:
        """Queue current baselines behind every earlier committed update."""
        async with self._locked():
            baselines = self._channel_baselines(
                subscription.channels, subscription.account_id
            )
            subscription.offer(
                frames(
                    process_id=self.process_id,
                    channel="control",
                    sequence=0,
                    commit_id=self._state.sequence,
                    kind="heartbeat",
                    payload={"channels": baselines},
                )
            )

    async def cancel_order(
        self, *, identity: AuthenticatedIdentity, order_id: str
    ) -> Cancellation:
        async with self._locked():
            account = self._account(identity, Permission.TRADE)
            order = self._owned(account, order_id)
            if order.status in (OrderStatus.FILLED, OrderStatus.CANCELLED):
                raise TradingError("order_finished", 409)
            candidate = _Candidate.of(self._state)
            try:
                result = candidate.engine.cancel(order_id=order.order_id)
            except OrderNotFound:
                raise RuntimeError(
                    "an open stored order is missing from the book"
                ) from None
            candidate.orders[order.order_id] = replace(
                result.order, commit_version=candidate.sequence
            )
            candidate.ledger.reconcile(
                candidate.engine.list_open_orders(), self.amounts
            )
            receipt = Cancellation(order.order_id, self.process_id, candidate.sequence)
            self._commit(candidate)
            return receipt

    def _balances(self, account: str) -> tuple[Balance, ...]:
        cash, asset = self._state.ledger.total[account]
        held_cash, held_asset = self._state.ledger.held[account]
        return (
            Balance(
                self.amounts.instrument.quote_asset,
                decimal(cash - held_cash, self.amounts.cash_increment),
                decimal(held_cash, self.amounts.cash_increment),
            ),
            Balance(
                self.amounts.instrument.base_asset,
                decimal(asset - held_asset, self.amounts.instrument.quantity_increment),
                decimal(held_asset, self.amounts.instrument.quantity_increment),
            ),
        )

    def _baselines(self, account: str) -> tuple[tuple[str, int], ...]:
        return tuple(
            (channel, self._state.channels.get((channel, account), 0))
            for channel in ("orders", "fills")
        )

    async def get_account_snapshot(
        self, *, identity: AuthenticatedIdentity
    ) -> AccountSnapshot:
        async with self._locked():
            account = self._account(identity, Permission.READ)
            return AccountSnapshot(
                self.process_id,
                self._state.sequence,
                self._balances(account),
                self._store.account_orders(account),
                self._store.counts(account)[1],
                self._baselines(account),
            )

    async def get_order(
        self, *, identity: AuthenticatedIdentity, order_id: str
    ) -> OrderSnapshot:
        async with self._locked():
            account = self._account(identity, Permission.READ)
            return self._owned(account, order_id)

    def _page(
        self,
        *,
        count: int,
        fetch: Callable[[int, int], Sequence],
        scope: str,
        limit: int,
        cursor: str | None,
        high_watermark: int | None = None,
        newest_first: bool = False,
    ) -> dict:
        """Page insertion-ordered history in O(page size).

        Offsets are ordinals: fetch(start, stop) returns records numbered in
        (start, stop]. Pruned ordinals leave gaps, so a page may be short.
        """
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise TradingError("invalid_limit")
        offset, high = 0, count if high_watermark is None else high_watermark
        if cursor:
            try:
                raw = base64.urlsafe_b64decode(cursor.encode("ascii"))
                payload, signature = raw[:-32], raw[-32:]
                if not hmac.compare_digest(
                    signature, hmac.digest(self._cursor_key, payload, "sha256")
                ):
                    raise ValueError
                info = json.loads(payload)
                if info["scope"] != scope or info["process"] != self.process_id:
                    raise ValueError
                offset, high = info["offset"], info["high"]
                if high_watermark is not None and high != high_watermark:
                    raise ValueError
            except ValueError, TypeError, KeyError, UnicodeError:
                raise TradingError("invalid_cursor") from None
        if type(high) is not int or not 0 <= high <= count:
            raise TradingError("invalid_watermark")
        end = min(offset + limit, high)
        next_cursor = None
        if end < high:
            payload = json.dumps(
                {
                    "scope": scope,
                    "process": self.process_id,
                    "offset": end,
                    "high": high,
                },
                sort_keys=True,
            ).encode()
            next_cursor = base64.urlsafe_b64encode(
                payload + hmac.digest(self._cursor_key, payload, "sha256")
            ).decode()
        if newest_first:
            data = tuple(reversed(fetch(high - end, high - offset)))
        else:
            data = tuple(fetch(offset, end))
        return {
            "process_id": self.process_id,
            "commit_id": self._state.sequence,
            "data": data,
            "next_cursor": next_cursor,
            "high_watermark": high,
        }

    async def list_orders(
        self,
        *,
        identity: AuthenticatedIdentity,
        limit: int = 100,
        cursor: str | None = None,
        status: str | None = None,
    ) -> dict:
        async with self._locked():
            account = self._account(identity, Permission.READ)
            if status is not None and status not in {
                "open",
                "partially_filled",
                "filled",
                "cancelled",
            }:
                raise TradingError("invalid_status")
            page = self._page(
                count=self._store.counts(account)[0],
                fetch=lambda start, stop: self._store.orders_between(
                    account, start, stop
                ),
                scope=f"orders:{account}:{status}",
                limit=limit,
                cursor=cursor,
            )
            if status:
                page["data"] = tuple(o for o in page["data"] if o.status == status)
            return page

    async def list_fills(
        self,
        *,
        identity: AuthenticatedIdentity,
        limit: int = 100,
        cursor: str | None = None,
        high_watermark: int | None = None,
    ) -> dict:
        async with self._locked():
            account = self._account(identity, Permission.READ)
            return self._page(
                count=self._store.counts(account)[1],
                fetch=lambda start, stop: self._store.fills_between(
                    account, start, stop
                ),
                scope=f"fills:{account}",
                limit=limit,
                cursor=cursor,
                high_watermark=high_watermark,
            )

    async def get_balances(
        self, *, identity: AuthenticatedIdentity
    ) -> tuple[Balance, ...]:
        async with self._locked():
            return self._balances(self._account(identity, Permission.READ))

    async def get_balance_snapshot(
        self, *, identity: AuthenticatedIdentity
    ) -> tuple[int, tuple[Balance, ...]]:
        """Return balances with the commit they describe."""
        async with self._locked():
            account = self._account(identity, Permission.READ)
            return self._state.sequence, self._balances(account)

    async def list_accounts(
        self, *, identity: AuthenticatedIdentity
    ) -> tuple[int, tuple[AccountObservation, ...]]:
        """Return every account's funding, creation time and totals at one commit.

        The caller needs only the grant: an observer is not a trading account.
        Cost follows the number of accounts, never history.
        """
        require_permission(identity=identity, permission=Permission.OBSERVE_ACCOUNTS)
        async with self._locked():
            total = self._state.ledger.total
            return self._state.sequence, tuple(
                AccountObservation(
                    account,
                    policy,
                    created_at,
                    decimal(total[account][0], self.amounts.cash_increment),
                    decimal(
                        total[account][1], self.amounts.instrument.quantity_increment
                    ),
                )
                for account, (policy, created_at) in self._directory.items()
            )

    async def list_instruments(self) -> tuple[Instrument, ...]:
        return (self.amounts.instrument,)

    async def get_order_book(self) -> OrderBookSnapshot:
        """Return the aggregated book; its sequence is the commit it describes."""
        async with self._locked():
            book = self._state.engine.get_order_book()
            return replace(book, sequence=self._state.sequence)

    async def list_trades(self, *, limit: int = 100, cursor: str | None = None) -> dict:
        async with self._locked():
            return self._page(
                count=self._state.engine.count_executions(),
                fetch=self._store.trades_between,
                scope="trades:newest",
                limit=limit,
                cursor=cursor,
                newest_first=True,
            )

    async def publish_news(
        self, *, identity: AuthenticatedIdentity, draft: NewsDraft
    ) -> NewsItem:
        """Store and distribute one immutable item; needs only publish_news.

        News creates no trading commit: its envelope names the latest commit.
        """
        async with self._locked():
            require_permission(identity=identity, permission=Permission.PUBLISH_NEWS)
            try:
                item = self._news.prepare(draft)
            except NewsRejected:
                raise TradingError("invalid_request") from None
            # Encoding can fail and must happen before the item is stored.
            sequence = self._news_count + 1
            bundle = frames(
                process_id=self.process_id,
                channel="news",
                sequence=sequence,
                commit_id=self._state.sequence,
                kind="update",
                payload=(item,),
            )
            self._durably(lambda: self._store.append_news(sequence, item))
            self._news_count = sequence
            self._deliver((("news", "", bundle),))
            return item

    async def list_news(
        self,
        *,
        limit: int = 100,
        cursor: str | None = None,
        high_watermark: int | None = None,
        instrument_id: str | None = None,
    ) -> dict:
        """Page news newest first; the filter applies after slicing."""
        async with self._locked():
            if instrument_id is not None and not self._news.is_listed(instrument_id):
                raise TradingError("invalid_request")
            page = self._page(
                count=self._news_count,
                fetch=self._store.news_between,
                scope=f"news:{instrument_id or '*'}",
                limit=limit,
                cursor=cursor,
                high_watermark=high_watermark,
                newest_first=True,
            )
            if instrument_id is not None:
                page["data"] = tuple(
                    item
                    for item in page["data"]
                    if instrument_id in item.instrument_ids
                )
            return page


_CHANNELS = frozenset({"book", "trades", "orders", "fills", "news"})


def _trade(execution: Execution) -> Trade:
    """Project an execution anonymously: exchange order IDs, never owners."""
    return Trade(
        execution.execution_id,
        execution.instrument_id,
        execution.price,
        execution.quantity,
        execution.executed_at,
        execution.maker_order_id,
        execution.taker_order_id,
        execution.side,
    )
