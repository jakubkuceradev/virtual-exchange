---
type: Reference
title: Funded Trading Slice
---

# Funded trading slice

`virtual_exchange.exchange.Exchange` owns complete funded operations for one
instrument. An app-owned instance combines a balance-independent matching engine
with operator allocations, reservations, immediate fee-free settlement, and
private queries. Bots use ordinary funded accounts. Persistence, deposits,
withdrawals, margin, shorting, and unlimited bot funding are deferred.

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

## Configuration

`Exchange.from_config(path=...)` loads this private JSON shape:

```json
{"version": 1, "instrument": {
  "instrument_id": "ABC-USD", "base_asset": "ABC", "quote_asset": "USD",
  "price_increment": "0.01", "quantity_increment": "0.1"
}, "accounts": {
  "alice": {"cash": "1000", "asset": "0"},
  "bob": {"cash": "0", "asset": "10"}
}}
```

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
contain coherent balances, retained orders and a fill watermark. Network adapters
and live delivery follow in the next stacked changes.

`exchange/tests/test_trading.py` covers the Alice/Bob trade, price savings,
partial cancellation, inventory protection, competing funding requests,
self-trade releases, conservation, restart, grants/ownership, client IDs,
pagination, low Decimal precision and failure isolation after reservation,
matching, settlement, and reconciliation.
