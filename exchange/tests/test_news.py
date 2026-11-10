"""Verify news publication, permissions, pagination and live recovery."""

import hashlib
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from virtual_exchange.api import create_app
from virtual_exchange.auth import Authenticator, PermissionDenied
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.service import TradingError
from virtual_exchange.types import (
    AuthenticatedIdentity,
    Instrument,
    NewsDraft,
    Permission,
)

D = Decimal
PUBLISHER = AuthenticatedIdentity("newsroom", frozenset({Permission.PUBLISH_NEWS}))


@pytest.fixture
def anyio_backend():
    return "asyncio"


def new_exchange():
    return Exchange(
        instrument=Instrument("ABC-USD", "ABC", "USD", D("0.01"), D("0.1")),
        allocations={"alice": (D(1000), D(3)), "bob": (D(0), D(10))},
    )


@pytest.fixture
def exchange():
    return new_exchange()


@pytest.fixture
def api(exchange):
    auth = Authenticator(
        credentials={
            hashlib.sha256(token.encode()).hexdigest(): owner
            for token, owner in [
                # "newsroom" has no trading allocation: news needs none.
                ("newsroom", PUBLISHER),
                ("alice", AuthenticatedIdentity("alice", frozenset(Permission))),
                (
                    "reader",
                    AuthenticatedIdentity(
                        "alice", frozenset({Permission.READ, Permission.TRADE})
                    ),
                ),
            ]
        }
    )
    with TestClient(create_app(authenticator=auth, exchange=exchange)) as client:
        yield client


def publish(api, token="newsroom", **fields):
    body = {"headline": "ABC beats estimates", **fields}
    headers = {} if token is None else {"Authorization": "Bearer " + token}
    return api.post("/news", headers=headers, json=body)


def subscribe(socket, channels):
    socket.send_json({"type": "subscribe", "channels": channels})
    control = socket.receive_json()
    assert control["type"] == "subscribed"
    return control["payload"]["channels"]


def all_news(api, **params):
    items, cursor = [], None
    while True:
        query = {**params, **({"cursor": cursor} if cursor else {})}
        page = api.get("/news", params=query).json()
        items.extend(page["data"])
        if (cursor := page["next_cursor"]) is None:
            return items


def test_publish_requires_publish_news_grant(api):
    response = publish(api, token=None)
    assert response.status_code == 401
    assert response.json() == {"error": "authentication_required"}
    response = publish(api, token="reader")
    assert response.status_code == 403
    assert response.json() == {"error": "insufficient_scope"}
    assert 'scope="publish_news"' in response.headers["WWW-Authenticate"]
    assert api.get("/news").json()["data"] == []

    response = publish(
        api,
        body="Quarterly results announced.",
        instrument_ids=["ABC-USD"],
        event_at="2026-12-01T09:30:00Z",
    )
    assert response.status_code == 201
    result = response.json()
    item = result["data"]
    assert result["process_id"] == api.get("/news").json()["process_id"]
    assert item["headline"] == "ABC beats estimates"
    assert item["body"] == "Quarterly results announced."
    assert item["instrument_ids"] == ["ABC-USD"]
    assert item["event_at"] == "2026-12-01T09:30:00+00:00"
    assert item["news_id"]
    published = datetime.fromisoformat(item["published_at"])
    assert abs(datetime.now(UTC) - published) < timedelta(seconds=5)

    minimal = publish(api, token="alice").json()["data"]
    assert minimal["body"] is None
    assert minimal["instrument_ids"] == []
    assert minimal["event_at"] is None
    identity = api.get("/identity", headers={"Authorization": "Bearer newsroom"})
    assert identity.json() == {
        "account_id": "newsroom",
        "permissions": ["publish_news"],
    }


@pytest.mark.parametrize(
    "fields",
    [
        {"headline": ""},
        {"headline": "   "},
        {"headline": "x" * 201},
        {"headline": 7},
        {"body": "x" * 2001},
        {"body": 3},
        {"instrument_ids": ["XYZ-USD"]},
        {"instrument_ids": ["ABC-USD", "ABC-USD"]},
        {"instrument_ids": "ABC-USD"},
        {"event_at": "tomorrow"},
        {"event_at": "2026-12-01T09:30:00"},
        {"event_at": "2026-12-01T09:30:00+01:00"},
        {"event_at": "2026-12-01"},
        {"event_at": "2026-12-01T25:30:00Z"},
        {"event_at": 1764581400},
        {"publisher": "someone"},
    ],
)
def test_invalid_fields_are_rejected_and_store_nothing(api, fields):
    with api.websocket_connect("/ws") as socket:
        subscribe(socket, ["news"])
        response = publish(api, **fields)
        assert response.status_code == 400
        assert response.json() == {"error": "invalid_request"}
        assert api.get("/news").json()["data"] == []
        publish(api, headline="next")
        # The first delivered item is the valid one: nothing leaked before it.
        update = socket.receive_json()
        assert update["sequence"] == 1
        assert update["payload"][0]["headline"] == "next"


def test_malformed_body_and_boundary_lengths(api):
    # A lone surrogate parses from JSON but could never be encoded back out.
    for raw in (b"{", rb'{"headline": "\ud800"}'):
        response = api.post(
            "/news", headers={"Authorization": "Bearer newsroom"}, content=raw
        )
        assert response.status_code == 400
        assert response.json() == {"error": "invalid_request"}
    assert api.get("/news").json()["data"] == []
    item = publish(
        api, headline="x" * 200, body="y" * 2000, event_at="2020-01-01T00:00:00.5Z"
    ).json()["data"]
    assert len(item["headline"]) == 200
    # Past events are accepted; the publisher's clock is not the exchange's.
    assert item["event_at"] == "2020-01-01T00:00:00.500000+00:00"


def test_list_newest_first_pagination_and_filter(api):
    published = [
        publish(
            api, headline=f"n{i}", instrument_ids=["ABC-USD"] if i % 2 else []
        ).json()["data"]
        for i in range(5)
    ]
    page = api.get("/news", params={"limit": 2}).json()
    assert [i["headline"] for i in page["data"]] == ["n4", "n3"]
    assert page["high_watermark"] == 5
    publish(api, headline="late")
    # The cursor keeps the first page's high watermark.
    rest = api.get("/news", params={"limit": 2, "cursor": page["next_cursor"]})
    assert [i["headline"] for i in rest.json()["data"]] == ["n2", "n1"]
    assert all_news(api, high_watermark=5) == published[::-1]
    assert [i["headline"] for i in all_news(api, instrument_id="ABC-USD")] == [
        "n3",
        "n1",
    ]
    filtered = api.get("/news", params={"limit": 1, "instrument_id": "ABC-USD"})
    # Filters apply after slicing, so pages can be empty; follow next_cursor.
    assert filtered.json()["data"] == []
    assert filtered.json()["next_cursor"]
    for params, code in [
        ({"instrument_id": "XYZ-USD"}, "invalid_request"),
        ({"limit": 0}, "invalid_limit"),
        ({"cursor": "bogus"}, "invalid_cursor"),
        ({"high_watermark": 99}, "invalid_watermark"),
        (
            {"instrument_id": "ABC-USD", "cursor": page["next_cursor"]},
            "invalid_cursor",
        ),
    ]:
        response = api.get("/news", params=params)
        assert (response.status_code, response.json()) == (400, {"error": code})


def test_channel_matches_list_and_reconnect_recovers(api):
    with api.websocket_connect("/ws") as socket:
        assert subscribe(socket, ["news", "trades"]) == {"news": 0, "trades": 0}
        for i in range(3):
            publish(api, headline=f"live{i}")
        live = [socket.receive_json() for _ in range(3)]
    assert [m["sequence"] for m in live] == [1, 2, 3]
    assert all(m["channel"] == "news" and m["type"] == "update" for m in live)
    streamed = [m["payload"][0] for m in live]
    # Same items, same order: the list is newest first.
    assert all_news(api) == streamed[::-1]

    # Missed while disconnected.
    publish(api, headline="missed")
    with api.websocket_connect("/ws") as socket:
        baseline = subscribe(socket, ["news"])["news"]
        publish(api, headline="after")
        buffered = socket.receive_json()
    assert baseline == 4
    recovered = all_news(api, high_watermark=baseline)
    assert [i["headline"] for i in recovered[::-1]] == [
        "live0",
        "live1",
        "live2",
        "missed",
    ]
    assert buffered["sequence"] == baseline + 1
    assert buffered["payload"][0]["headline"] == "after"


def test_news_leaves_trading_channels_untouched(api):
    with api.websocket_connect("/ws") as socket:
        before = subscribe(socket, ["book", "trades"])
        for _ in range(3):  # Book snapshot markers.
            socket.receive_json()
        publish(api)
        api.post(
            "/orders",
            headers={"Authorization": "Bearer alice"},
            json={
                "instrument_id": "ABC-USD",
                "side": "buy",
                "price": "1",
                "quantity": "1",
            },
        )
        update = socket.receive_json()
    assert before == {"book": 0, "trades": 0}
    # The news item was not delivered, and the book sequence did not skip.
    assert (update["channel"], update["sequence"], update["commit_id"]) == (
        "book",
        1,
        1,
    )
    snapshot = api.get(
        "/account/snapshot", headers={"Authorization": "Bearer alice"}
    ).json()
    assert snapshot["commit_id"] == 1
    assert snapshot["channel_baselines"] == {"orders": 1, "fills": 0}


def test_news_requires_configured_exchange():
    with TestClient(create_app(authenticator=Authenticator())) as client:
        assert client.get("/news").status_code == 503


@pytest.mark.anyio
async def test_in_process_rules_and_restart(exchange):
    with pytest.raises(PermissionDenied):
        await exchange.publish_news(
            identity=AuthenticatedIdentity("alice", frozenset({Permission.READ})),
            draft=NewsDraft("hello"),
        )
    for draft in [
        NewsDraft("hello", event_at=datetime(2026, 12, 1)),
        NewsDraft("hello", instrument_ids=["ABC-USD"]),
        NewsDraft("hello", instrument_ids=(1,)),
    ]:
        with pytest.raises(TradingError, match="invalid_request"):
            await exchange.publish_news(identity=PUBLISHER, draft=draft)
    zero = timezone(timedelta(0))
    item = await exchange.publish_news(
        identity=PUBLISHER,
        draft=NewsDraft("hello", event_at=datetime(2026, 12, 1, tzinfo=zero)),
    )
    assert item.event_at.tzinfo is UTC
    page = await exchange.list_news()
    assert page["data"] == (item,)

    await exchange.publish_news(identity=PUBLISHER, draft=NewsDraft("again"))
    cursor = (await exchange.list_news(limit=1))["next_cursor"]
    restarted = new_exchange()
    assert (await restarted.list_news())["data"] == ()
    with pytest.raises(TradingError, match="invalid_cursor"):
        await restarted.list_news(cursor=cursor)
