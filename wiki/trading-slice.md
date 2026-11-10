---
type: Reference
title: Funded Trading Slice
---

# Funded trading slice

`virtual_exchange.exchange.Exchange` owns complete funded operations for one
instrument. An app-owned instance combines a balance-independent matching engine
with operator allocations, reservations, immediate fee-free settlement, and
private queries. Bots are ordinary API clients; the operator may assign an
account unlimited funding (below). Persistence, deposits, withdrawals, margin,
and shorting for funded accounts are deferred.

## Financial and consistency contract

Buy orders reserve limit price times size; sells reserve inventory. Actual
executions transfer cash and inventory, and release buy-price savings. Cancellation
and decrement-and-cancel release only the removed quantities; prevented size never
settles as a trade. Holds are derived from open-order remainders after each
command, so they always equal resting-order requirements; the derivation also
rejects any candidate with negative or overcommitted balances.
Cash uses integer units of price increment times quantity increment; inventory
uses integer lots. Decimal context cannot round internal amounts. Values with
more than 38 significant digits, or a scale more than 38 decimal places away from
the relevant increment, are rejected before integer arithmetic, so hostile exponents
cannot stall the event loop.

Operations require a trusted `AuthenticatedIdentity`, with trade for submit/cancel
and read for account queries. Ownership checks hide foreign IDs as unknown.
Accepted client UUIDv4s are unique per account/process: retries return a duplicate
conflict, not a new trade. Lookup uses `client:<uuid>`; without a client ID a lost
response is not safely retryable. Unmatched requests rejected before acceptance
consume no client ID. This retry policy is a project choice, not a promise of
Coinbase lifetime deduplication.

One asyncio lock serializes commands and queries on one event loop. Every command
reserves, matches, settles and validates against a private candidate; the complete
candidate's changes are absorbed only after success. A candidate overlays retained
history instead of copying it: only open orders, price-level totals and account
balances are copied, and each command records its own changed orders, fills and
client IDs. Command cost depends on the open book, accounts and the command's own
changes, not on process lifetime; history queries page by slicing. Retained history
still grows in memory until restart in this slice; the agreed direction is for
persistence to move history to storage rather than keep it in memory. Private fills
carry `liquidity`: `maker` for the resting order, `taker` for the incoming order,
following Coinbase's fill liquidity indicator. No durability or multi-worker consistency is
promised. Restart restores configured allocations, new process identity, and no
orders, fills, or holds; token configuration is independent.

## Time in force

Orders take `time_in_force`, following Coinbase: `GTC` (default) rests any
unfilled remainder; `IOC` matches like a limit order at its limit price and the
engine cancels the remainder at once, so it never rests or reaches the book.
An IOC ends `filled`, or `cancelled` with `filled_quantity` and
`cancelled_quantity` giving the split (an IOC that fills nothing is accepted and
cancelled, not rejected). It reserves the full limit cost like GTC, so a funded
IOC can still fail with `insufficient_funds`; derived holds release the rest in
the same command. Self-trade prevention is unchanged. Order snapshots report
`time_in_force`. GTT and FOK are not supported.

## Unlimited funding

Funding policy is per account and set only by operator configuration: `funded`
(default) or `unlimited`. The ledger owns the policy. Unlimited accounts are
never rejected for insufficient funds and their cash and asset balances may go
negative; holds are still derived from open orders, so `reserved` keeps its
meaning and `available` may be negative. Every execution still settles, so
balances show the net position and total cash/asset across accounts is
conserved. Validation, self-trade prevention, permissions, cancellation and
observations are unchanged. Funding is not yet exposed over the API; the
ranking data slice publishes it so the website can exclude unlimited (operator
bot) accounts, as decided in [competition](/competition.md#bot-exclusion).

## Configuration

`Exchange.from_config(path=...)` loads this private JSON shape:

```json
{"version": 1, "instrument": {
  "instrument_id": "ABC-USD", "base_asset": "ABC", "quote_asset": "USD",
  "price_increment": "0.01", "quantity_increment": "0.1"
}, "accounts": {
  "alice": {"cash": "1000", "asset": "0"},
  "bob": {"cash": "0", "asset": "10"},
  "market-maker": {"cash": "0", "asset": "0", "funding": "unlimited"}
}}
```

`funding` is optional (`funded` or `unlimited`); restart restores it with the
allocations.

All amounts are strings, finite, nonnegative and exactly aligned to the relevant
units. Invalid configuration fails with sanitized errors. The examples are
fixtures, not fixed funding policy. Authenticated accounts without an allocation
are denied trading/account access. Keep configuration outside checkouts/images.

## In-process usage and verification

```python
exchange = Exchange(instrument=instrument, allocations=allocations)
receipt = await exchange.submit_order(identity=alice, order=limit_order)
order = await exchange.get_order(identity=alice, order_id=receipt.order_id)
snapshot = await exchange.get_account_snapshot(identity=alice)
```

The module-level trading stubs are replaced by this instance API. Public data
comes from the same instance. Retained history is per-process; paginated results
have signed account/filter/process-scoped cursors and an insertion high watermark.
Order status is current at page read, not frozen across pages. Recovery snapshots
contain coherent balances, retained orders and a fill watermark. REST and live adapters share this instance, as described below.

`exchange/tests/test_bot_support.py` covers maker-side public trades, IOC and
unlimited funding. `exchange/tests/test_trading.py` covers the Alice/Bob trade, price savings,
partial cancellation, inventory protection, competing funding requests,
self-trade releases, conservation, restart, grants/ownership, client IDs,
pagination, low Decimal precision and failure isolation after reservation,
matching, settlement, and reconciliation.

## REST API

Set EXCHANGE_TRADING_CONFIG to a private allocation JSON file before starting the
app. Unset config disables trading/data with 503 while health and identity work.
Use one Uvicorn worker: state is process-local, not shared between workers.

| Route | Permission and result |
| --- | --- |
| POST /orders | trade; 201 receipt with exchange/client IDs, accepted_at and process_id |
| DELETE /orders/{id} | trade + ownership; cancellation receipt |
| GET /orders/{id} | read + ownership; snapshot, also supports client:<uuid> |
| GET /orders, /fills, /balances | read; own observations only |
| GET /account/snapshot | read; coherent balances, orders, fill watermark and channel baselines (`{"orders": n, "fills": n}`) |
| GET /instruments, /book, /trades | public, ignores optional credentials |

POST requires instrument_id, side, price and quantity, with optional
time_in_force (`GTC` or `IOC`); amounts must be canonical
unsigned decimal strings such as `100` or `0.5` (no exponents, signs, separators,
whitespace or leading zeros). Responses use plain decimal notation, scaled to the
relevant increment. /book and /balances include the commit_id they describe. Optional type must be limit; optional client_order_id is a canonical
UUIDv4. Extra fields are rejected; client account selectors never establish identity.
No final fills/status are included in the submission receipt. Commands may finish
before the receipt arrives; a lost response can be reconciled with GET
/orders/client:<uuid>. Repeated accepted UUIDs conflict even after cancellation.
A not-found lookup does not prove an earlier in-flight request cannot commit;
retry the same UUID if needed, never silently substitute a new one.

Malformed/domain inputs return sanitized 400 codes; missing/invalid auth returns
401, insufficient grants or unprovisioned accounts 403, foreign/unknown orders
404, insufficient funds/duplicate IDs/terminal cancellation 409. Pages default to
100, maximum 1000; cursor scopes include account, filter and process. Orders can
filter status. Filtered pages may be empty; follow next_cursor until null.
The insertion high watermark stays fixed while snapshots reflect
current state at each page read. Fills accept high_watermark from the recovery
snapshot. A new process invalidates old cursors. Public Trade projections expose
exchange maker/taker IDs without accounts or private client IDs, and `side`:
the **maker** order's side, as in Coinbase match messages; the taker's side is
the opposite. Private fills keep their own-order `side` and `liquidity`.

`exchange/tests/test_trading_api.py` verifies real HTTP trades, exact balances,
permissions/ownership, malformed input, client-ID recovery, pagination, public
privacy, disabled trading, and authentication before malformed-body parsing.

## WebSocket observations

Connect to /ws and subscribe once within 5 seconds:

```json
{"type":"subscribe","channels":["book","trades","orders","fills"],"token":"<private token>"}
```

Public-only book/trades subscriptions need no token. Private orders/fills require
a read grant and use only the token's provisioned account; no account selector
is accepted. Invalid supplied tokens reject the whole subscription. Never send
tokens in URLs or log subscription frames. There are no WebSocket order commands,
resubscriptions, or pushed balances; refresh balances through REST on private activity.

Initial subscribed gives channel baselines. Book initialization sends snapshot_start,
snapshot and snapshot_end before live absolute level updates (zero removes a level).
Registration and capture use the command lock, so a concurrent trade appears in
the snapshot or a subsequent update. All updates describe settled committed state.
Public trades expose anonymous maker/taker exchange IDs; private order/fill payloads
contain only the account's own activity. Channel sequences advance per nonempty
committed bundle, public per channel and private per account/channel.

Envelopes carry type, process_id, channel, sequence, commit_id, part and parts.
Small bundles carry payload directly. Large bundles carry payload_fragment strings;
concatenate parts in order and JSON-decode the complete payload before applying it.
Snapshot markers bracket all parts. Never apply an incomplete bundle. Per-message
outgoing size is at most 1 MiB. Channel gaps or interrupted bundles require recovery.

Subscribe before reconciling: buffer incoming updates, GET /account/snapshot at
commit S, fetch fills through its fill_high_watermark, deduplicate fills by fill_id,
and apply order versions newer than S. Rebuild public book from each fresh stream
snapshot. Trade history is retained per process and can be reconciled by stable
trade_id; public trade pages return newest first within their fixed high watermark. A changed process_id invalidates old observations and cursors. There is
no durable replay or exactly-once delivery. These are project schemas, inspired by
Coinbase public level2_batch absolute quantities; immediate post-commit delivery,
bearer auth, and private sequences differ from Coinbase's channels.

Incoming messages are limited to 64 KiB. Pending live delivery is bounded to
256 messages/1 MiB of backlog plus one in-flight send; overflow or a 5-second send
timeout closes with 1013. The limits bound backlog, not a single bundle: a caught-up
subscriber always accepts the next complete bundle, so multi-part bundles larger
than 1 MiB are delivered rather than forcing reconnects. Initial immutable snapshots are sent directly in bounded
parts while subsequent updates queue. Heartbeats every 10 seconds are queued behind
earlier updates, so their baselines never run ahead of delivered sequences; they do
not guarantee replay. Rejected credentials close 4401 and missing read grants or
unprovisioned accounts close 4403, mirroring HTTP 401/403, with the stable error
code (`authentication_required`, `invalid_token`, `insufficient_scope`,
`account_not_provisioned`) as the close reason so clients can stop reconnecting.
Malformed protocols close 1008, oversized input 1009, and unavailable trading 1013. Closing delivery never
undoes a committed trade. Subscriber cleanup survives ASGI cancellation.

The locked websockets runtime backend enables actual Uvicorn WebSockets; AnyIO
provides cancellation-safe cleanup. Run one process/worker. HTTP/WebSocket tests
cover both command/subscription orderings, owner isolation, self-trade updates,
ordered multiple fills, reconnect, restart, bounds, timeout and cleanup. A real
Uvicorn loopback demo observed all four event channels and Alice's 800 cash/2 units
with zero holds; restart restored configured allocations and unchanged token identity.
TLS, proxies and production slow networks are not established by these local checks.
