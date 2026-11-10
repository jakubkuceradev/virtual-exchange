"""Complete funded operations with private candidate state and atomic publication."""

import asyncio
import base64
import hmac
import json
from collections.abc import Callable, Mapping, Sequence
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
from virtual_exchange.exchange.matching import MatchingEngine
from virtual_exchange.exchange.news import NewsLog, NewsRejected
from virtual_exchange.exchange.observations import Subscription, frames
from virtual_exchange.types import (
    Acceptance,
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
    Permission,
    Trade,
)


class TradingError(ValueError):
    """Expose a stable rejection code without private resource details."""

    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(slots=True)
class _State:
    engine: MatchingEngine
    ledger: Ledger
    orders: dict[str, OrderSnapshot]
    account_orders: dict[str, list[str]]
    fills: dict[str, list[Fill]]
    clients: dict[tuple[str, str], str]
    channels: dict[tuple[str, str], int]
    sequence: int = 0

    def apply(self, candidate: _Candidate) -> None:
        """Absorb a validated candidate; only container updates remain."""
        if candidate.base is not self or candidate.sequence != self.sequence + 1:
            raise RuntimeError("candidate does not extend the current state")
        self.engine.commit(candidate.engine)
        self.ledger = candidate.ledger
        for order_id, snapshot in candidate.orders.items():
            if order_id not in self.orders:
                self.account_orders.setdefault(snapshot.account_id, []).append(order_id)
            self.orders[order_id] = snapshot
        for account, fills in candidate.fills.items():
            self.fills.setdefault(account, []).extend(fills)
        self.clients.update(candidate.clients)
        self.channels.update(candidate.channels)
        self.sequence = candidate.sequence


@dataclass(slots=True)
class _Candidate:
    """One command's private changes; discarded unless the whole command succeeds.

    Retained history stays in the base state and is read through, so the cost of
    a command depends on open orders, accounts and its own changes only.
    """

    base: _State
    engine: MatchingEngine
    ledger: Ledger
    sequence: int
    orders: dict[str, OrderSnapshot] = field(default_factory=dict)
    fills: dict[str, list[Fill]] = field(default_factory=dict)
    clients: dict[tuple[str, str], str] = field(default_factory=dict)
    channels: dict[tuple[str, str], int] = field(default_factory=dict)
    executions: tuple[Execution, ...] = ()

    @classmethod
    def of(cls, base: _State) -> _Candidate:
        return cls(base, base.engine.fork(), base.ledger.fork(), base.sequence + 1)

    def order(self, order_id: str) -> OrderSnapshot:
        return self.orders.get(order_id) or self.base.orders[order_id]

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
    ) -> None:
        """Accounts absent from funding are funded; only operators assign policy."""
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
        unlimited = frozenset(
            account
            for account, policy in funding.items()
            if policy == Funding.UNLIMITED
        )
        self.process_id = str(uuid4())
        self._subscribers: set[Subscription] = set()
        self._cursor_key = uuid4().bytes
        self._lock = asyncio.Lock()
        self._news = NewsLog(instrument_ids={instrument.instrument_id})
        self._state = _State(
            MatchingEngine(instrument=instrument),
            Ledger(values, unlimited),
            {},
            {account: [] for account in values},
            {account: [] for account in values},
            {},
            {},
        )

    @classmethod
    def from_config(cls, *, path: str | Path) -> Exchange:
        try:
            instrument, allocations, funding = load_config(path)
            return cls(instrument=instrument, allocations=allocations, funding=funding)
        except ValueError, ArithmeticError, TypeError:
            raise TradingConfigurationError("Invalid trading configuration") from None

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

    def _owned(self, state: _State, account: str, order_id: str) -> OrderSnapshot:
        if order_id.startswith("client:"):
            order_id = state.clients.get((account, order_id[7:]), "")
        order = state.orders.get(order_id)
        if order is None or order.account_id != account:
            raise TradingError("order_not_found", 404)
        return order

    async def submit_order(
        self, *, identity: AuthenticatedIdentity, order: LimitOrder
    ) -> Acceptance:
        async with self._lock:
            account = self._account(identity, Permission.TRADE)
            if order.instrument_id != self.amounts.instrument.instrument_id:
                raise TradingError("invalid_instrument")
            self._client_id(order.client_order_id)
            ticks, lots = self.amounts.order(
                side=order.side, price=order.price, quantity=order.quantity
            )
            if (
                order.client_order_id is not None
                and (account, order.client_order_id) in self._state.clients
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
            for snapshot in (*result.changed_resting_orders, result.order):
                candidate.orders[snapshot.order_id] = replace(
                    snapshot, commit_version=candidate.sequence
                )
            if order.client_order_id is not None:
                candidate.clients[account, order.client_order_id] = (
                    result.order.order_id
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
        async with self._lock:
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
            channel: len(self._news)
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
        async with self._lock:
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
        async with self._lock:
            account = self._account(identity, Permission.TRADE)
            order = self._owned(self._state, account, order_id)
            candidate = _Candidate.of(self._state)
            try:
                result = candidate.engine.cancel(order_id=order.order_id)
            except OrderRejected:
                raise TradingError("order_finished", 409) from None
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
        async with self._lock:
            account = self._account(identity, Permission.READ)
            return AccountSnapshot(
                self.process_id,
                self._state.sequence,
                self._balances(account),
                tuple(
                    self._state.orders[order_id]
                    for order_id in self._state.account_orders[account]
                ),
                len(self._state.fills[account]),
                self._baselines(account),
            )

    async def get_order(
        self, *, identity: AuthenticatedIdentity, order_id: str
    ) -> OrderSnapshot:
        async with self._lock:
            account = self._account(identity, Permission.READ)
            return self._owned(self._state, account, order_id)

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
        """Slice one page of insertion-ordered history in O(page size)."""
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
        async with self._lock:
            account = self._account(identity, Permission.READ)
            if status is not None and status not in {
                "open",
                "partially_filled",
                "filled",
                "cancelled",
            }:
                raise TradingError("invalid_status")
            ids = self._state.account_orders[account]
            page = self._page(
                count=len(ids),
                fetch=lambda start, stop: [
                    self._state.orders[order_id] for order_id in ids[start:stop]
                ],
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
        async with self._lock:
            account = self._account(identity, Permission.READ)
            fills = self._state.fills[account]
            return self._page(
                count=len(fills),
                fetch=lambda start, stop: fills[start:stop],
                scope=f"fills:{account}",
                limit=limit,
                cursor=cursor,
                high_watermark=high_watermark,
            )

    async def get_balances(
        self, *, identity: AuthenticatedIdentity
    ) -> tuple[Balance, ...]:
        async with self._lock:
            return self._balances(self._account(identity, Permission.READ))

    async def get_balance_snapshot(
        self, *, identity: AuthenticatedIdentity
    ) -> tuple[int, tuple[Balance, ...]]:
        """Return balances with the commit they describe."""
        async with self._lock:
            account = self._account(identity, Permission.READ)
            return self._state.sequence, self._balances(account)

    async def list_instruments(self) -> tuple[Instrument, ...]:
        return (self.amounts.instrument,)

    async def get_order_book(self) -> OrderBookSnapshot:
        """Return the aggregated book; its sequence is the commit it describes."""
        async with self._lock:
            book = self._state.engine.get_order_book()
            return replace(book, sequence=self._state.sequence)

    async def list_trades(self, *, limit: int = 100, cursor: str | None = None) -> dict:
        async with self._lock:
            engine = self._state.engine
            return self._page(
                count=engine.count_executions(),
                fetch=lambda start, stop: [
                    _trade(e) for e in engine.list_executions(start=start, stop=stop)
                ],
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
        async with self._lock:
            require_permission(identity=identity, permission=Permission.PUBLISH_NEWS)
            try:
                item = self._news.prepare(draft)
            except NewsRejected:
                raise TradingError("invalid_request") from None
            # Encoding can fail and must happen before the item is stored.
            bundle = frames(
                process_id=self.process_id,
                channel="news",
                sequence=len(self._news) + 1,
                commit_id=self._state.sequence,
                kind="update",
                payload=(item,),
            )
            self._news.append(item)
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
        async with self._lock:
            if instrument_id is not None and not self._news.is_listed(instrument_id):
                raise TradingError("invalid_request")
            page = self._page(
                count=len(self._news),
                fetch=self._news.items,
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
