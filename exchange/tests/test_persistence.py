"""Verify durable commits, crash recovery and configuration-versus-store rules."""

import hashlib
import importlib.util
import json
import os
import random
import signal
import sqlite3
import subprocess
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path

import pytest

from virtual_exchange.admin import main as admin
from virtual_exchange.api import create_app
from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.configuration import TradingConfigurationError
from virtual_exchange.exchange.service import TradingError
from virtual_exchange.exchange.store import Store, StoreConflict, StoreError
from virtual_exchange.types import Funding, LimitOrder, NewsDraft, OrderSide

HARNESS = Path(__file__).with_name("persistence_harness.py")
_spec = importlib.util.spec_from_file_location("persistence_harness", HARNESS)
harness = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(harness)

D = Decimal
identity = harness.identity
INSTRUMENT = harness.INSTRUMENT


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def state_dir(tmp_path):
    Store.create(tmp_path)
    return tmp_path


def reopen(state_dir, allocations=None, funding=None, instrument=INSTRUMENT):
    return Exchange(
        instrument=instrument,
        allocations=harness.ALLOCATIONS if allocations is None else allocations,
        funding=funding,
        store=Store.open(state_dir),
    )


def buy(price="100", quantity="1", client=None):
    return LimitOrder("ABC-USD", OrderSide.BUY, D(price), D(quantity), client)


def sell(price="100", quantity="1", client=None):
    return LimitOrder("ABC-USD", OrderSide.SELL, D(price), D(quantity), client)


# ---- Crash harness (AC1, AC2) ----


def start(state_dir, *arguments):
    return subprocess.Popen(
        [sys.executable, str(HARNESS), str(state_dir), *arguments],
        stdout=subprocess.PIPE,
        text=True,
    )


def parse(line):
    kind, *rest = line.split()
    return kind, tuple(rest)


async def verify(state_dir, acks):
    """Every acknowledged command is present; nothing is half-applied."""
    exchange = reopen(state_dir)
    try:
        state = await harness.observe(exchange)
        commands = 0
        for kind, rest in acks:
            if kind == "submit":
                account, client = rest
                await exchange.get_order(
                    identity=identity(account), order_id=f"client:{client}"
                )
                commands += 1
            elif kind == "cancel":
                account, order_id = rest
                order = await exchange.get_order(
                    identity=identity(account), order_id=order_id
                )
                assert order.status == "cancelled"
                commands += 1
            else:
                assert rest[0] in {item["news_id"] for item in state["news"]}
        assert state["commit_id"] >= commands
        # Cash and inventory are conserved across all accounts.
        totals = Counter()
        for account in state["accounts"].values():
            for balance in account["balances"]:
                totals[balance["asset_id"]] += D(balance["available"]) + D(
                    balance["reserved"]
                )
        assert totals == {"USD": D(15000), "ABC": D(60)}
        # Each trade settled both sides: two fills, and orders agree with fills.
        fills = {}
        filled = Counter()
        for account in state["accounts"].values():
            for fill in account["fills"]:
                fills[fill["fill_id"]] = fill
                filled[fill["order_id"]] += D(fill["quantity"])
        assert len(fills) == 2 * len(state["trades"])
        for trade in state["trades"]:
            for order_id in (trade["maker_order_id"], trade["taker_order_id"]):
                assert f"{trade['trade_id']}:{order_id}" in fills
        trade_ids = sorted(int(t["trade_id"]) for t in state["trades"])
        assert trade_ids == list(range(1, len(trade_ids) + 1))
        for account in state["accounts"].values():
            reserved = {"USD": D(0), "ABC": D(0)}
            for order in account["orders"]:
                assert D(order["filled_quantity"]) == filled[order["order_id"]]
                remaining = D(order["remaining_quantity"])
                if order["side"] == "buy":
                    reserved["USD"] += D(order["limit_price"]) * remaining
                else:
                    reserved["ABC"] += remaining
            for balance in account["balances"]:
                assert D(balance["reserved"]) == reserved[balance["asset_id"]]
        return state
    finally:
        exchange.close()


@pytest.mark.anyio
async def test_sigkill_restores_everything_exactly(state_dir):
    child = start(state_dir, "--seed", "1", "--operations", "300")
    acks = []
    for line in child.stdout:
        kind, rest = parse(line)
        if kind == "observed":
            observed = json.loads(line.split(" ", 1)[1])
            break
        acks.append((rest[0], rest[1:]))
    child.send_signal(signal.SIGKILL)
    child.wait()
    assert observed["trades"] and observed["news"] and observed["priority"]
    recovered = await verify(state_dir, acks)
    assert recovered == observed


def trial_plan(trials):
    rng = random.Random(20261110)
    for trial in range(trials):
        stage = (*harness.STAGES, None)[trial % 5]
        yield trial, stage, rng.randint(1, 100), rng.randint(1, 100)


@pytest.mark.anyio
async def test_crash_at_random_points_and_every_commit_stage(tmp_path):
    """AC2; PERSISTENCE_TRIALS=1000 runs the full acceptance count."""
    trials = int(os.environ.get("PERSISTENCE_TRIALS", "25"))
    stages = Counter()
    for trial, stage, nth, after in trial_plan(trials):
        state_dir = tmp_path / str(trial)
        state_dir.mkdir()
        Store.create(state_dir)
        options = ["--seed", str(trial), "--operations", "150"]
        if stage:
            options += ["--stage", stage, "--nth", str(nth)]
        child = start(state_dir, *options)
        acks, fired = [], True
        for line in child.stdout:
            kind, rest = parse(line)
            if kind == "observed" or (stage is None and len(acks) == after):
                fired = kind != "observed"
                child.send_signal(signal.SIGKILL)
                break
            acks.append((rest[0], rest[1:]))
        child.wait()
        killed = child.returncode == -signal.SIGKILL
        assert killed, f"trial {trial} exited with {child.returncode}"
        if fired:
            stages[stage or "random"] += 1
        await verify(state_dir, acks)
    # Most kills land mid-run; a few plans outlast the run's writes.
    assert set(stages) == {*harness.STAGES, "random"}
    print("in-stage kills:", dict(stages), "of", trials, "trials")


# ---- Restart behaviour (AC3, AC4) ----


@pytest.mark.anyio
async def test_queue_priority_survives_restart(state_dir):
    exchange = reopen(state_dir)
    older = await exchange.submit_order(identity=identity("bob"), order=sell())
    newer = await exchange.submit_order(identity=identity("carol"), order=sell())
    exchange.close()
    exchange = reopen(state_dir)
    await exchange.submit_order(identity=identity("alice"), order=buy())
    assert (
        await exchange.get_order(identity=identity("bob"), order_id=older.order_id)
    ).status == "filled"
    remaining = await exchange.get_order(
        identity=identity("carol"), order_id=newer.order_id
    )
    assert remaining.status == "open"
    exchange.close()


@pytest.mark.anyio
async def test_restart_identity_counters_and_cursors(state_dir):
    exchange = reopen(state_dir)
    alice, bob = identity("alice"), identity("bob")
    for _ in range(3):
        await exchange.submit_order(identity=bob, order=sell())
        await exchange.submit_order(identity=alice, order=buy(client=None))
    await exchange.publish_news(identity=harness.PUBLISHER, draft=NewsDraft("one"))
    before = await exchange.get_account_snapshot(identity=alice)
    cursor = (await exchange.list_orders(identity=alice, limit=1))["next_cursor"]
    trades = (await exchange.list_trades())["data"]
    exchange.close()

    exchange = reopen(state_dir)
    after = await exchange.get_account_snapshot(identity=alice)
    assert after.process_id != before.process_id
    assert after.commit_id == before.commit_id == 6
    assert after.orders == before.orders
    assert after.fill_high_watermark == before.fill_high_watermark == 3
    # Channel sequences are process-scoped and restart; news follows its count.
    subscription = await exchange.subscribe(
        channels=frozenset({"orders", "news"}), identity=alice
    )
    assert json.loads(subscription.initial[0])["payload"]["channels"] == {
        "news": 1,
        "orders": 0,
    }
    with pytest.raises(TradingError, match="invalid_cursor"):
        await exchange.list_orders(identity=alice, cursor=cursor)
    assert (await exchange.list_trades())["data"] == trades

    await exchange.submit_order(identity=bob, order=sell())
    cancel = await exchange.cancel_order(
        identity=bob,
        order_id=(await exchange.list_orders(identity=bob, status="open"))["data"][
            0
        ].order_id,
    )
    assert cancel.commit_id == 8
    await exchange.submit_order(identity=bob, order=sell())
    await exchange.submit_order(identity=alice, order=buy())
    assert (await exchange.list_trades())["data"][0].trade_id == "4"
    fills = await exchange.list_fills(identity=alice)
    assert fills["high_watermark"] == 4
    item = await exchange.publish_news(
        identity=harness.PUBLISHER, draft=NewsDraft("two")
    )
    assert (await exchange.list_news())["high_watermark"] == 2
    assert (await exchange.list_news())["data"][0] == item
    exchange.close()


@pytest.mark.anyio
async def test_client_ids_survive_restart(state_dir):
    client = "2f6c1ab0-41cf-4f3c-a52b-0c1b4c3c2f1e"
    exchange = reopen(state_dir)
    receipt = await exchange.submit_order(
        identity=identity("alice"), order=buy(client=client)
    )
    exchange.close()
    exchange = reopen(state_dir)
    found = await exchange.get_order(
        identity=identity("alice"), order_id=f"client:{client}"
    )
    assert found.order_id == receipt.order_id
    with pytest.raises(TradingError, match="duplicate_client_id"):
        await exchange.submit_order(
            identity=identity("alice"), order=buy(client=client)
        )
    exchange.close()


# ---- Configuration versus store (AC5) ----


def digest(state_dir):
    with sqlite3.connect(Store.path(state_dir)) as db:
        return hashlib.sha256("\n".join(db.iterdump()).encode()).hexdigest()


@pytest.mark.anyio
async def test_persisted_state_wins_over_configuration(state_dir):
    exchange = reopen(state_dir)
    await exchange.submit_order(identity=identity("bob"), order=sell())
    await exchange.submit_order(identity=identity("alice"), order=buy())
    exchange.close()

    exchange = reopen(
        state_dir,
        allocations={
            "alice": (D(1), D(1)),
            "dave": (D(7), D(3)),
        },
    )
    balances = await exchange.get_balances(identity=identity("alice"))
    assert [(b.available, b.reserved) for b in balances] == [
        (D(4900), D(0)),
        (D(21), D(0)),
    ]
    dave = await exchange.get_balances(identity=identity("dave"))
    assert [b.available for b in dave] == [D(7), D(3)]
    # Removed from configuration, bob keeps his balances and keeps trading.
    await exchange.submit_order(identity=identity("bob"), order=sell("101"))
    exchange.close()


@pytest.mark.parametrize(
    "change,message",
    [
        ({"instrument": {"price_increment": D("0.05")}}, "price_increment"),
        ({"instrument": {"quantity_increment": D("0.1")}}, "quantity_increment"),
        ({"instrument": {"instrument_id": "XYZ-USD"}}, "instrument_id"),
        ({"funding": {"bob": Funding.UNLIMITED}}, "funding for account 'bob'"),
    ],
)
def test_conflicting_configuration_refuses_and_leaves_store(state_dir, change, message):
    from dataclasses import replace

    reopen(state_dir).close()
    before = digest(state_dir)
    with pytest.raises(StoreConflict, match=message):
        reopen(
            state_dir,
            instrument=replace(INSTRUMENT, **change.get("instrument", {})),
            funding=change.get("funding"),
        )
    assert digest(state_dir) == before
    reopen(state_dir).close()


# ---- Store lifecycle and failure ----


def test_store_lifecycle_is_explicit(tmp_path, capsys):
    with pytest.raises(StoreError, match="init-store"):
        Store.open(tmp_path)
    assert admin(["--state-dir", str(tmp_path), "init-store"]) == 0
    assert admin(["--state-dir", str(tmp_path), "init-store"]) == 1
    assert "already exists" in capsys.readouterr().err
    store = Store.open(tmp_path)
    with pytest.raises(StoreError, match="Another exchange process"):
        Store.open(tmp_path)
    store.close()
    Store.open(tmp_path).close()


def test_app_requires_state_dir_with_trading_config(tmp_path, monkeypatch):
    monkeypatch.setenv("EXCHANGE_TRADING_CONFIG", str(tmp_path / "trading.json"))
    monkeypatch.delenv("EXCHANGE_STATE_DIR", raising=False)
    with pytest.raises(TradingConfigurationError, match="EXCHANGE_STATE_DIR"):
        create_app(authenticator=Authenticator())


@pytest.mark.anyio
async def test_failed_write_stops_trading_and_commits_nothing(state_dir):
    stopped = []
    exchange = Exchange(
        instrument=INSTRUMENT,
        allocations=harness.ALLOCATIONS,
        store=Store.open(state_dir),
        on_store_failure=lambda: stopped.append(True),
    )
    await exchange.submit_order(identity=identity("bob"), order=sell())
    subscription = await exchange.subscribe(channels=frozenset({"trades"}))

    def broken(**_):
        raise sqlite3.OperationalError("disk I/O error")

    exchange._store.commit = broken
    with pytest.raises(TradingError, match="trading_unavailable") as error:
        await exchange.submit_order(identity=identity("alice"), order=buy())
    assert error.value.status == 503 and stopped == [True]
    assert subscription.queue.empty()
    with pytest.raises(TradingError, match="trading_unavailable"):
        await exchange.get_balances(identity=identity("alice"))
    exchange.close()
    exchange = reopen(state_dir)
    assert (await exchange.list_trades())["data"] == ()
    assert (await exchange.get_order_book()).asks[0].quantity == D(1)
    exchange.close()


# ---- Retention ----


@pytest.mark.anyio
async def test_retention_prunes_only_old_zero_fill_terminal_orders(
    state_dir, monkeypatch
):
    import time

    from virtual_exchange.exchange import service

    monkeypatch.setattr(service, "PRUNE_BATCH", 2)
    alice, bob = identity("alice"), identity("bob")
    exchange = reopen(state_dir)
    cancelled = []
    for index in range(5):
        client = f"00000000-0000-4000-8000-00000000000{index}"
        receipt = await exchange.submit_order(
            identity=alice, order=buy("90", client=client)
        )
        await exchange.cancel_order(identity=alice, order_id=receipt.order_id)
        cancelled.append((client, receipt.order_id))
    resting = await exchange.submit_order(identity=alice, order=buy("95"))
    await exchange.submit_order(identity=bob, order=sell())
    filled = await exchange.submit_order(identity=alice, order=buy())
    before = await exchange.get_account_snapshot(identity=alice)
    fills = await exchange.list_fills(identity=alice)

    assert await exchange.prune_history() == 0
    later = time.time() + service.RETENTION_SECONDS + 60
    assert await exchange.prune_history(now=later) == 5
    for client, order_id in cancelled:
        for lookup in (order_id, f"client:{client}"):
            with pytest.raises(TradingError, match="order_not_found"):
                await exchange.get_order(identity=alice, order_id=lookup)
    after = await exchange.get_account_snapshot(identity=alice)
    assert [o.order_id for o in after.orders] == [
        resting.order_id,
        filled.order_id,
    ]
    assert after.balances == before.balances
    assert await exchange.list_fills(identity=alice) == {
        **fills,
        "commit_id": after.commit_id,
    }
    # Ordinals keep their meaning: the watermark is unchanged and pages skip gaps.
    page = await exchange.list_orders(identity=alice, limit=4)
    assert page["high_watermark"] == 7 and page["data"] == ()
    rest = await exchange.list_orders(identity=alice, cursor=page["next_cursor"])
    assert [o.order_id for o in rest["data"]] == [resting.order_id, filled.order_id]
    # A pruned order's client ID is no longer reserved.
    await exchange.submit_order(identity=alice, order=buy("90", client=cancelled[0][0]))
    exchange.close()
