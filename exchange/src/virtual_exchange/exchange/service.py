"""Complete funded operations with private candidate state and atomic publication."""

import asyncio
import base64
import hmac
import json
from collections.abc import Mapping
from dataclasses import dataclass, replace
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
from virtual_exchange.exchange.observations import Subscription, frames
from virtual_exchange.types import (
    Acceptance,
    AccountSnapshot,
    AuthenticatedIdentity,
    Balance,
    Cancellation,
    Fill,
    Instrument,
    LimitOrder,
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
    fills: dict[str, tuple[Fill, ...]]
    clients: dict[tuple[str, str], str]
    channels: dict[tuple[str, str], int]
    sequence: int = 0

    def fork(self) -> _State:
        return _State(
            self.engine.fork(),
            self.ledger.fork(),
            self.orders.copy(),
            self.fills.copy(),
            self.clients.copy(),
            self.channels.copy(),
            self.sequence,
        )


class Exchange:
    """Serialize complete trading operations; expose only consistent observations."""

    def __init__(
        self,
        *,
        instrument: Instrument,
        allocations: Mapping[str, tuple[Decimal, Decimal]],
    ) -> None:
        self.amounts = Amounts(instrument)
        values = {}
        for account, (cash, asset) in allocations.items():
            if not isinstance(account, str) or not account:
                raise OrderRejected("account ID must be a nonempty string")
            values[account] = (
                self.amounts.allocation(cash, cash=True),
                self.amounts.allocation(asset, cash=False),
            )
        self.process_id = str(uuid4())
        self._subscribers: set[Subscription] = set()
        self._cursor_key = uuid4().bytes
        self._lock = asyncio.Lock()
        self._state = _State(
            MatchingEngine(instrument=instrument),
            Ledger(values),
            {},
            dict.fromkeys(values, ()),
            {},
            {},
        )

    @classmethod
    def from_config(cls, *, path: str | Path) -> Exchange:
        try:
            instrument, allocations = load_config(path)
            return cls(instrument=instrument, allocations=allocations)
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
            candidate = self._state.fork()
            candidate.ledger.reserve(account, order.side, ticks, lots)
            result = candidate.engine.submit(
                account_id=account,
                side=order.side,
                price=order.price,
                quantity=order.quantity,
                client_order_id=order.client_order_id,
            )
            candidate.sequence += 1
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
                for snapshot in (maker, taker):
                    fill = Fill(
                        f"{execution.execution_id}:{snapshot.order_id}",
                        execution.execution_id,
                        snapshot.order_id,
                        execution.instrument_id,
                        snapshot.side,
                        execution.price,
                        execution.quantity,
                        execution.executed_at,
                        candidate.sequence,
                    )
                    candidate.fills[snapshot.account_id] += (fill,)
            candidate.ledger.reconcile(candidate.orders.values(), self.amounts)
            receipt = Acceptance(
                result.order.order_id,
                order.client_order_id,
                result.order.accepted_at,
                self.process_id,
            )
            self._commit(candidate)
            return receipt

    def _prepare_observations(
        self, candidate: _State
    ) -> tuple[tuple[str, str, tuple[str, ...]], ...]:
        old = self._state
        changes = []
        previous = old.engine.get_order_book()
        current = candidate.engine.get_order_book()
        for side, before, after in (
            ("buy", previous.bids, current.bids),
            ("sell", previous.asks, current.asks),
        ):
            before_map = {level.price: level.quantity for level in before}
            after_map = {level.price: level.quantity for level in after}
            for price in sorted(
                before_map.keys() | after_map.keys(), reverse=side == "buy"
            ):
                if before_map.get(price, Decimal(0)) != after_map.get(
                    price, Decimal(0)
                ):
                    changes.append(
                        {
                            "side": side,
                            "price": price,
                            "quantity": after_map.get(price, Decimal(0)),
                        }
                    )
        payloads = []
        if changes:
            payloads.append(("book", "", changes))
        executions = candidate.engine.list_executions()[
            len(old.engine.list_executions()) :
        ]
        if executions:
            payloads.append(
                (
                    "trades",
                    "",
                    tuple(
                        Trade(
                            e.execution_id,
                            e.instrument_id,
                            e.price,
                            e.quantity,
                            e.executed_at,
                            e.maker_order_id,
                            e.taker_order_id,
                        )
                        for e in executions
                    ),
                )
            )
        for account in candidate.ledger.total:
            orders = tuple(
                o
                for o in candidate.orders.values()
                if o.account_id == account and o.commit_version == candidate.sequence
            )
            fills = candidate.fills[account][len(old.fills[account]) :]
            if orders:
                payloads.append(("orders", account, orders))
            if fills:
                payloads.append(("fills", account, fills))
        bundles = []
        for channel, account, payload in payloads:
            key = channel, account
            sequence = candidate.channels.get(key, 0) + 1
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

    def _commit(self, candidate: _State) -> None:
        # Encoding can fail and must happen before any authoritative mutation.
        bundles = self._prepare_observations(candidate)
        self._state = candidate
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
            if not channels or not channels <= {"book", "trades", "orders", "fills"}:
                raise TradingError("invalid_channels")
            account = None
            if channels & {"orders", "fills"}:
                if identity is None:
                    raise TradingError("authentication_required", 401)
                account = self._account(identity, Permission.READ)
            baselines = {
                channel: self._state.channels.get(
                    (channel, account if channel in {"orders", "fills"} else ""), 0
                )
                for channel in sorted(channels)
            }
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

    async def unsubscribe(self, subscription: Subscription) -> None:
        async with self._lock:
            self._subscribers.discard(subscription)

    async def heartbeat(self, subscription: Subscription) -> tuple[str, ...]:
        async with self._lock:
            baselines = {
                channel: self._state.channels.get(
                    (
                        channel,
                        subscription.account_id
                        if channel in {"orders", "fills"}
                        else "",
                    ),
                    0,
                )
                for channel in sorted(subscription.channels)
            }
            return frames(
                process_id=self.process_id,
                channel="control",
                sequence=0,
                commit_id=self._state.sequence,
                kind="heartbeat",
                payload={"channels": baselines},
            )

    async def cancel_order(
        self, *, identity: AuthenticatedIdentity, order_id: str
    ) -> Cancellation:
        async with self._lock:
            account = self._account(identity, Permission.TRADE)
            order = self._owned(self._state, account, order_id)
            candidate = self._state.fork()
            try:
                result = candidate.engine.cancel(order_id=order.order_id)
            except OrderRejected:
                raise TradingError("order_finished", 409) from None
            candidate.sequence += 1
            candidate.orders[order.order_id] = replace(
                result.order, commit_version=candidate.sequence
            )
            candidate.ledger.reconcile(candidate.orders.values(), self.amounts)
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
                    o for o in self._state.orders.values() if o.account_id == account
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
        records: tuple,
        *,
        scope: str,
        limit: int,
        cursor: str | None,
        high_watermark: int | None = None,
        newest_first: bool = False,
    ) -> dict:
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise TradingError("invalid_limit")
        offset, high = 0, len(records) if high_watermark is None else high_watermark
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
        if type(high) is not int or not 0 <= high <= len(records):
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
        return {
            "process_id": self.process_id,
            "commit_id": self._state.sequence,
            "data": (records[:high][::-1] if newest_first else records)[offset:end],
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
            orders = tuple(
                o for o in self._state.orders.values() if o.account_id == account
            )
            page = self._page(
                orders, scope=f"orders:{account}:{status}", limit=limit, cursor=cursor
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
            return self._page(
                self._state.fills[account],
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

    async def list_instruments(self) -> tuple[Instrument, ...]:
        return (self.amounts.instrument,)

    async def get_order_book(self):
        async with self._lock:
            return self._state.engine.get_order_book()

    def _trades(self) -> tuple[Trade, ...]:
        return tuple(
            Trade(
                e.execution_id,
                e.instrument_id,
                e.price,
                e.quantity,
                e.executed_at,
                e.maker_order_id,
                e.taker_order_id,
            )
            for e in self._state.engine.list_executions()
        )

    async def list_trades(self, *, limit: int = 100, cursor: str | None = None) -> dict:
        async with self._lock:
            return self._page(
                self._trades(),
                scope="trades:newest",
                limit=limit,
                cursor=cursor,
                newest_first=True,
            )
