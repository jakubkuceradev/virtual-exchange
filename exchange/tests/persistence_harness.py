"""Crash harness: run mixed commands against a store, then die by SIGKILL.

Run as a child process. It prints one ``ack`` line per acknowledged command,
after the command returns, so the parent knows exactly what the exchange
acknowledged. With ``--stage`` it kills itself inside the N-th durable write at
that stage. If it survives every operation, it prints its observed state and
waits to be killed.
"""

import argparse
import asyncio
import json
import os
import random
import signal
import sys
import uuid
from decimal import Decimal

from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.ledger import InsufficientFunds
from virtual_exchange.exchange.service import TradingError
from virtual_exchange.exchange.store import Store
from virtual_exchange.serialization import wire
from virtual_exchange.types import (
    AuthenticatedIdentity,
    Instrument,
    LimitOrder,
    NewsDraft,
    OrderSide,
    Permission,
    TimeInForce,
)

D = Decimal
INSTRUMENT = Instrument("ABC-USD", "ABC", "USD", D("0.01"), D("1"))
ALLOCATIONS = {
    "alice": (D(5000), D(20)),
    "bob": (D(5000), D(20)),
    "carol": (D(5000), D(20)),
}
STAGES = ("before_write", "before_commit", "after_commit", "before_deliver")
PUBLISHER = AuthenticatedIdentity("newsroom", frozenset({Permission.PUBLISH_NEWS}))


def identity(account):
    return AuthenticatedIdentity(
        account, frozenset({Permission.READ, Permission.TRADE})
    )


def open_exchange(state_dir):
    return Exchange(
        instrument=INSTRUMENT, allocations=ALLOCATIONS, store=Store.open(state_dir)
    )


async def everything(page, **options):
    items, cursor = [], None
    while True:
        result = await page(cursor=cursor, limit=1000, **options)
        items.extend(result["data"])
        if not (cursor := result["next_cursor"]):
            return items


async def observe(exchange):
    """Everything a client can observe, without process-scoped identities."""
    accounts = {}
    for account in sorted(ALLOCATIONS):
        who = identity(account)
        snapshot = await exchange.get_account_snapshot(identity=who)
        clients = {
            order.client_order_id: (
                await exchange.get_order(
                    identity=who, order_id=f"client:{order.client_order_id}"
                )
            ).order_id
            for order in snapshot.orders
            if order.client_order_id
        }
        accounts[account] = {
            "balances": wire(snapshot.balances),
            "orders": wire(snapshot.orders),
            "fills": wire(await everything(exchange.list_fills, identity=who)),
            "clients": clients,
            "fill_high_watermark": snapshot.fill_high_watermark,
        }
    book = await exchange.get_order_book()
    return {
        "commit_id": snapshot.commit_id,
        "accounts": accounts,
        "book": wire({"bids": book.bids, "asks": book.asks}),
        "priority": [o.order_id for o in exchange._state.engine.list_open_orders()],
        "trades": wire(await everything(exchange.list_trades)),
        "news": wire(await everything(exchange.list_news)),
    }


def install_kill(exchange, stage, nth):
    """SIGKILL this process inside the nth durable write at the given stage."""
    store = exchange._store
    writes = 0

    def die():
        os.kill(os.getpid(), signal.SIGKILL)

    commit, append_news = store.commit, store.append_news

    def counted(write):
        def wrapper(*args, **kwargs):
            nonlocal writes
            writes += 1
            if writes == nth and stage == "before_write":
                die()
            return write(*args, **kwargs)

        return wrapper

    store.commit, store.append_news = counted(commit), counted(append_news)

    class Connection:
        def __init__(self, inner):
            self._inner = inner

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def execute(self, sql, *args):
            if writes == nth and sql == "COMMIT" and stage == "before_commit":
                die()
            result = self._inner.execute(sql, *args)
            if writes == nth and sql == "COMMIT" and stage == "after_commit":
                die()
            return result

    store._db = Connection(store._db)
    deliver = exchange._deliver

    def deliver_or_die(bundles):
        if writes == nth and stage == "before_deliver":
            die()
        deliver(bundles)

    exchange._deliver = deliver_or_die


async def run(state_dir, seed, operations, stage, nth):
    exchange = open_exchange(state_dir)
    if stage:
        install_kill(exchange, stage, nth)
    rng = random.Random(seed)
    open_orders = []
    for _ in range(operations):
        choice = rng.random()
        try:
            if choice < 0.05:
                item = await exchange.publish_news(
                    identity=PUBLISHER, draft=NewsDraft(f"news {rng.random()}")
                )
                print("ack news", item.news_id, flush=True)
            elif choice < 0.3 and open_orders:
                account, order_id = open_orders.pop(rng.randrange(len(open_orders)))
                await exchange.cancel_order(
                    identity=identity(account), order_id=order_id
                )
                print("ack cancel", account, order_id, flush=True)
            else:
                account = rng.choice(sorted(ALLOCATIONS))
                client = str(uuid.uuid4())
                receipt = await exchange.submit_order(
                    identity=identity(account),
                    order=LimitOrder(
                        "ABC-USD",
                        rng.choice(list(OrderSide)),
                        D(rng.randint(98, 102)),
                        D(rng.randint(1, 5)),
                        client,
                        rng.choice([TimeInForce.GTC, TimeInForce.GTC, TimeInForce.IOC]),
                    ),
                )
                open_orders.append((account, receipt.order_id))
                print("ack submit", account, client, flush=True)
        except InsufficientFunds, TradingError:
            pass
    # A stage whose write never came (rejections write nothing) ends here too.
    print("observed", json.dumps(await observe(exchange)), flush=True)
    await asyncio.sleep(3600)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("state_dir")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--operations", type=int, default=200)
    parser.add_argument("--stage", choices=STAGES)
    parser.add_argument("--nth", type=int, default=1)
    arguments = parser.parse_args()
    asyncio.run(
        run(
            arguments.state_dir,
            arguments.seed,
            arguments.operations,
            arguments.stage,
            arguments.nth,
        )
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
