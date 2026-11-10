---
type: Reference
title: Market News
---

# Market news

The exchange stores and distributes immutable news items; what they say is
decided by an external publisher (the private market controller). Items live in
the app-owned `Exchange` beside trades, in memory only: restart clears them with
the process ID. Editing, deletion and persistence are out of scope.

## Publishing

`POST /news` requires the `publish_news` grant, assigned only by operator
[authentication](/authentication.md) configuration. It is independent of `read`
and `trade`, and a news-only token needs no trading allocation. Body fields:

| Field | Rule |
| --- | --- |
| headline | required string, 1–200 code points, not whitespace-only |
| body | optional string or null, up to 2,000 code points |
| instrument_ids | optional list of distinct listed instruments; default `[]` |
| event_at | optional RFC 3339 time with explicit `Z` or `+00:00`; past times are accepted because publisher and exchange clocks differ |

The exchange assigns `news_id` (UUID4) and `published_at` (UTC). The response is
201 `{"process_id", "data": item}`; the publishing account is neither stored nor
exposed. Any invalid field, extra field, lone surrogate or malformed body returns
400 `invalid_request` and stores or publishes nothing. Missing/invalid tokens get
401 and missing grants 403 `insufficient_scope`, as elsewhere.

## Reading and recovery

`GET /news` is public and uses the standard page: newest first, limit 100/1000,
signed process-scoped cursor, fixed `high_watermark`, and an optional
`high_watermark` parameter like `/fills`. An `instrument_id` filter must name a
listed instrument and applies after slicing, so filtered pages may be empty;
follow `next_cursor` until null.

The public WebSocket `news` channel needs no token and has no snapshot. Each item
is one bundle with a one-element payload list, so the channel sequence equals the
number of items and its `subscribed`/heartbeat baseline N is also a list high
watermark. Recover by subscribing, buffering, paging `GET /news?high_watermark=N`,
then applying buffered items with sequence above N; `news_id` is also stable for
deduplication. Publication creates no trading commit: the envelope `commit_id`
is the latest trading commit, and trading sequences and order commit versions
are unaffected.

## Implementation and verification

`exchange/news.py` (`NewsLog`) owns validation and order; `Exchange.publish_news`
and `list_news` add locking, grants, paging and delivery; `news_api.py` adapts
HTTP. `exchange/tests/test_news.py` covers grants, every validation rule, paging,
filters, channel/list equivalence, reconnect recovery, isolation from trading
channels and restart. A real Uvicorn loopback run published, streamed and
recovered items with synthetic credentials.
