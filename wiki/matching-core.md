---
type: Reference
title: In-memory Matching Core
---

# In-memory matching core

`virtual_exchange.exchange.matching.MatchingEngine` implements the first trading
milestone: one instrument, limit orders, sequential commands, and no persistent
state. Its caller supplies orders whose funding eligibility is assumed. It is
an internal component, not a participant API for bypassing account checks.

```python
from decimal import Decimal

from virtual_exchange.exchange.matching import MatchingEngine
from virtual_exchange.types import Instrument, OrderSide

engine = MatchingEngine(instrument=Instrument(
    "ABC-USD", "ABC", "USD", Decimal("0.01"), Decimal("0.1"),
))
engine.submit(client_order_id="sell", account_id="bob", side=OrderSide.SELL,
              price=Decimal("100"), quantity=Decimal("2"))
result = engine.submit(client_order_id="buy", account_id="alice", side=OrderSide.BUY,
                       price=Decimal("100"), quantity=Decimal("2"))
assert result.executions[0].price == Decimal("100")
```

## Contract

- Commands match best price first, then engine receipt order at equal prices.
  Executions use the resting order's price. Self-trade prevention uses
  decrement-and-cancel: remove the smaller remainder from both self-owned orders,
  cancelling either exhausted order. A surviving incoming order continues matching;
  a surviving maker retains its priority. Earlier executions are preserved and
  prevented quantity never creates an execution.
- Inputs require `OrderSide`, finite positive `Decimal` values aligned to the
  instrument's increments, nonempty account IDs, and optional nonempty string
  client IDs. Float inputs are rejected. Integer ticks/lots avoid Decimal-context
  rounding. The engine assigns unique UUIDv4 exchange order IDs; client IDs are
  separate metadata and may repeat. This establishes no retry/deduplication rule.
  Future HTTP client IDs follow UUIDv4; this internal milestone accepts string tags.
- `OrderRejected` leaves state unchanged.
- `cancel(order_id=...)` cancels only the unfilled remainder. Cancelling a
  terminal order raises `OrderRejected` without changing state. Unknown order
  reads/cancellations raise `OrderNotFound`. Internal terminal snapshots remain
  inspectable, without promising eventual public history retention.
- `MatchingResult` contains the command's order, changed resting orders, ordered
  executions. `Execution` identifies both
  maker and taker orders. These are internal facts for future settlement, not
  public market-data records.
- `get_order`, `get_order_book`, and `list_executions` return immutable snapshots.
  Book levels aggregate remaining quantities, bids descending and asks ascending;
  empty sides are empty tuples. Sequence advances once per effective command.
  Rejections and terminal cancellations do not advance it. Observation timestamps
  are UTC; execution IDs are stable and unique within one engine instance.
- Snapshots retain original `quantity` and expose cumulative `filled_quantity`,
  `remaining_quantity`, `prevented_quantity`, and `cancelled_quantity` (explicit
  cancellation). These four quantities sum to the original quantity. Changed maker
  snapshots report both sides of prevention for later reservation release. Never
  derive resting liquidity by subtracting only fills from original quantity.
- Status is OPEN or PARTIALLY_FILLED while remaining quantity is positive.
  An exhausted order is FILLED if all its quantity executed, otherwise CANCELLED.
  A reduced order can later execute its surviving remainder without erasing
  its prevented quantity. There is no separate cancellation reason: the
  prevented and cancelled quantities on each snapshot, including changed makers,
  record why quantity was removed.

The engine owns matching state; callers never mutate book entries. Private book
storage can be indexed later without changing the command contract. Thread
safety, account settlement, HTTP integration, recovery, and market orders are
outside this milestone. Public trading/market-data functions remain stubs.
A future trading coordinator must reserve funds before matching and consistently
settle results; sharing a process alone will not provide that guarantee.

## Verification and reference

`exchange/tests/test_matching.py` exercises the agreed matching examples,
rejection invariance, FIFO after partial fills, both incoming sides, terminal
cancellation, self-trade prevention, and exact arithmetic under low Decimal
precision. Run `uv run --project exchange --locked pytest exchange/tests/test_matching.py`.

[Coinbase matching documentation](https://docs.cdp.coinbase.com/exchange/concepts/matching-engine)
is the technical reference for price-time priority, maker-price execution, and
default decrement-and-cancel self-trade prevention. Our limit-only, sequential,
single-instrument scope deliberately simplifies the reference.
