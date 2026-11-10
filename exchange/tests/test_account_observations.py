"""Verify the observe_accounts listing: grant, consistency and creation times."""

import hashlib
import sqlite3
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from virtual_exchange.api import create_app
from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.store import Store, StoreError
from virtual_exchange.types import (
    AuthenticatedIdentity,
    Funding,
    Instrument,
    Permission,
)

INSTRUMENT = Instrument("ABC-USD", "ABC", "USD", Decimal("0.01"), Decimal("0.1"))
ALLOCATIONS = {
    "alice": (Decimal(1000), Decimal(0)),
    "bob": (Decimal(0), Decimal(10)),
    "carol": (Decimal(0), Decimal(0)),
}
TOKENS = [
    ("alice", "alice", [Permission.READ, Permission.TRADE]),
    ("bob", "bob", [Permission.READ, Permission.TRADE]),
    ("carol", "carol", [Permission.READ, Permission.TRADE]),
    # The observer is a service identity, not a provisioned trading account.
    ("observer", "website", [Permission.OBSERVE_ACCOUNTS]),
]


def open_exchange(state_dir, allocations=ALLOCATIONS):
    return Exchange(
        instrument=INSTRUMENT,
        allocations=allocations,
        funding={"carol": Funding.UNLIMITED},
        store=Store.open(state_dir),
    )


def client_for(exchange):
    auth = Authenticator(
        credentials={
            hashlib.sha256(token.encode()).hexdigest(): AuthenticatedIdentity(
                account, frozenset(grants)
            )
            for token, account, grants in TOKENS
        }
    )
    return TestClient(create_app(authenticator=auth, exchange=exchange))


def headers(token):
    return {"Authorization": "Bearer " + token}


def order(side, quantity, price="100"):
    return {
        "instrument_id": "ABC-USD",
        "side": side,
        "quantity": quantity,
        "price": price,
    }


@pytest.fixture
def state_dir(tmp_path):
    Store.create(tmp_path)
    return tmp_path


def test_listing_requires_the_observe_accounts_grant(state_dir):
    with client_for(open_exchange(state_dir)) as api:
        missing = api.get("/accounts")
        assert missing.status_code == 401
        assert missing.json() == {"error": "authentication_required"}
        denied = api.get("/accounts", headers=headers("alice"))
        assert denied.status_code == 403
        assert denied.json() == {"error": "insufficient_scope"}
        assert 'scope="observe_accounts"' in denied.headers["WWW-Authenticate"]
        allowed = api.get("/accounts", headers=headers("observer"))
        assert allowed.status_code == 200
        assert allowed.headers["Cache-Control"] == "no-store"


def test_listing_matches_balances_at_its_commit(state_dir):
    with client_for(open_exchange(state_dir)) as api:
        # Alice rests a partly filled bid (reserved cash); unlimited carol sells
        # past zero, so her asset total is negative.
        assert (
            api.post(
                "/orders", headers=headers("alice"), json=order("buy", "5")
            ).status_code
            == 201
        )
        assert (
            api.post(
                "/orders", headers=headers("carol"), json=order("sell", "3")
            ).status_code
            == 201
        )
        assert (
            api.post(
                "/orders", headers=headers("bob"), json=order("sell", "1", "120")
            ).status_code
            == 201
        )

        listing = api.get("/accounts", headers=headers("observer")).json()
        rows = {row["account_id"]: row for row in listing["data"]}
        assert [row["account_id"] for row in listing["data"]] == sorted(ALLOCATIONS)
        assert rows["carol"]["funding"] == "unlimited"
        assert set(rows["alice"]) == {
            "account_id",
            "funding",
            "created_at",
            "cash",
            "asset",
            "fill_count",
        }
        # Alice's bid filled against carol only; bob's ask rests untouched.
        assert {k: r["fill_count"] for k, r in rows.items()} == {
            "alice": 1,
            "bob": 0,
            "carol": 1,
        }
        assert rows["alice"]["cash"] == "700.000"  # 200 of it reserved
        assert rows["carol"]["asset"] == "-3.0"

        for account, row in rows.items():
            snapshot = api.get("/balances", headers=headers(account)).json()
            assert snapshot["commit_id"] == listing["commit_id"]
            assert snapshot["process_id"] == listing["process_id"]
            totals = {
                b["asset_id"]: Decimal(b["available"]) + Decimal(b["reserved"])
                for b in snapshot["data"]
            }
            assert totals == {
                "USD": Decimal(row["cash"]),
                "ABC": Decimal(row["asset"]),
            }


def test_creation_times_persist_and_mark_later_accounts(state_dir):
    exchange = open_exchange(state_dir)
    with client_for(exchange) as api:
        first = api.get("/accounts", headers=headers("observer")).json()["data"]
    exchange.close()
    created = {row["account_id"]: row["created_at"] for row in first}
    assert len(set(created.values())) == 1  # one startup records them together

    exchange = open_exchange(
        state_dir, {**ALLOCATIONS, "dave": (Decimal(5), Decimal(0))}
    )
    with client_for(exchange) as api:
        second = api.get("/accounts", headers=headers("observer")).json()["data"]
    exchange.close()
    restarted = {row["account_id"]: row["created_at"] for row in second}
    assert {k: restarted[k] for k in created} == created
    assert datetime.fromisoformat(restarted["dave"]) > datetime.fromisoformat(
        created["alice"]
    )
    assert datetime.fromisoformat(restarted["dave"]).utcoffset().total_seconds() == 0


def test_version_one_store_is_refused(state_dir):
    with sqlite3.connect(Store.path(state_dir)) as db:
        db.execute("PRAGMA user_version = 1")
    with pytest.raises(StoreError, match="schema version 1"):
        Store.open(state_dir)
