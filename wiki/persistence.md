---
type: Decision
title: Exchange Persistence and Recovery
---

# Exchange persistence and recovery

Everything the exchange acknowledges is on disk before the response or any
WebSocket observation leaves the process. A crash, container restart or VM
reboot recovers the exact last committed state; only `process_id` and
process-scoped cursors and channel sequences start afresh. The exchange keeps
state in one SQLite file, owned by `virtual_exchange.exchange.store.Store`.

## Durable commit order

Each command builds its private candidate as before. Then `_commit`:

1. prepares the observation frames (encoding can fail, so it comes first);
2. writes the candidate's changed orders, fills, trades, touched balances and
   commit ID in one SQLite transaction (WAL, `synchronous=FULL`);
3. applies the candidate to memory;
4. delivers the frames, then returns the receipt.

Nothing awaits between steps 2 and 4, so cancellation cannot separate disk from
memory. News follows the same order with a single-row insert. If a durable write
fails, its outcome on disk is unknown: the exchange stops serving (503
`trading_unavailable`) and the app sends itself SIGTERM, so the supervisor
restarts it and recovery reads the truth. Memory never runs ahead of disk.

## Memory and history

Memory holds the live book (open orders in priority order), account balances,
funding policy, channel sequences and counters. Terminal orders, fills, trades,
client IDs and news live only in the store and are read by indexed key or range,
so memory follows open orders and accounts, not history length, and history
pages cost O(page size). `MatchingEngine` keeps only open orders and an
execution counter; callers record history from each `MatchingResult`.

Each account row also records `created_at`, set once when the store first
records the account and published by `GET /accounts`. Schema version 2 added
it; version 1 stores are refused, without migration, since none was deployed.

Rows store the full public record as a JSON body plus the columns used for
lookup, ordering, uniqueness and pruning, all derived from the same record in
the same statement. Balances are integer columns; holds are never stored.
History watermarks are per-account order and fill ordinals, the trade
sequence and the news count; all continue across restarts. Order pages select
an ordinal range, so pruned orders leave gaps and a page may be shorter than its
limit.

## Recovery and configuration

On start the exchange opens the store, takes an exclusive lock file so only one
process writes, and applies configuration in one transaction:

- an empty store records the configured instrument and every account;
- later starts keep persisted balances; only accounts new to the store get their
  configured allocation;
- accounts missing from configuration keep their state and keep trading if a
  token still authenticates;
- a changed instrument field (ID, assets, increments) or a changed funding policy
  for an existing account refuses startup with a message naming the field, and
  writes nothing.

It then rebuilds the book from open orders by acceptance priority and derives
holds with `Ledger.reconcile`, which also rejects inconsistent stored state.
Clients keep the published rule: a changed `process_id` invalidates streams,
cursors and cached observations, and they resynchronise from snapshots, which
now return persisted state.

## Store lifecycle

`EXCHANGE_STATE_DIR` names the store directory (`exchange.sqlite3` plus
`exchange.lock`). Starting with `EXCHANGE_TRADING_CONFIG` set requires it, and
the exchange never creates a store itself, so a missing volume fails startup
instead of starting a fresh competition. An operator creates an empty store once:

```sh
python -m virtual_exchange.admin init-store   # uses EXCHANGE_STATE_DIR
```

It refuses if a store exists. A new season or test environment starts from a
new empty directory. `Exchange(...)` without a store uses an ephemeral
in-memory database, for tests and embedding.

## Retention

Decided, not yet implemented: fills, trades, news and every order with a fill
are kept indefinitely; terminal orders with zero fills are pruned after 7 days,
after which `GET /orders/{id}` and client-ID lookups return not-found, and the
client UUID is no longer reserved. Rankings need only fills and trades.

## Open items

- **Website restart copy (TODO).** `website/frontend/src/live/session.ts`
  (website stack, PR #13 → #16) tells users that balances were reset and earlier
  orders were not carried over. With persistence that is wrong; replace it with
  copy such as "The exchange restarted; your account was restored from its last
  committed state." Whichever stack merges second makes the change and removes
  this item.
- **Account snapshot size.** `GET /account/snapshot` still lists every retained
  order of the account, now read from SQLite under the command lock. That keeps
  the website's recovery contract, but a bot account with days of cancelled
  orders makes a large snapshot. Revisit (for example open orders only, with
  history from `GET /orders`) if bots call it.
- Backup and restore procedure, the Compose volume and retention pruning follow
  in the operations slice.

## Verification

`exchange/tests/test_persistence.py` covers SIGKILL recovery of every observable
(balances, holds, open orders and priority, fills, trades, news, client IDs),
crash trials at random points and at every commit stage (before the write,
inside the transaction, after COMMIT, before delivery) with acknowledgement,
atomicity and conservation checks, queue priority, restart identity and
counters, configuration rules with an unchanged store on refusal, the explicit
lifecycle and single-writer lock, and fail-stop on a write error.
`exchange/tests/persistence_harness.py` is the crash child; set
`PERSISTENCE_TRIALS=1000` for the full acceptance run (CI runs 25).
