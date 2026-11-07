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
engine.submit(order_id="sell", account_id="bob", side=OrderSide.SELL,
              price=Decimal("100"), quantity=Decimal("2"))
result = engine.submit(order_id="buy", account_id="alice", side=OrderSide.BUY,
                       price=Decimal("100"), quantity=Decimal("2"))
assert result.executions[0].price == Decimal("100")
```

## Contract

- Commands match best price first, then engine receipt order at equal prices.
  Executions use the resting order's price. Unfilled quantities rest unless
  self-trade prevention cancels the incoming remainder. Earlier executions and
  the self-owned resting order are preserved.
- Inputs require `OrderSide`, finite positive `Decimal` values aligned to the
  instrument's increments, and nonempty string order/account IDs. Float inputs
  are rejected. Integer ticks/lots avoid Decimal-context rounding.
- `OrderRejected` leaves state unchanged. Accepted IDs cannot be reused during
  the instance's lifetime, including after fill or cancellation.
- `cancel(order_id=...)` cancels only the unfilled remainder. Cancelling a
  terminal order returns its existing state without new effects. Unknown order
  reads/cancellations raise `OrderNotFound`.
- `MatchingResult` contains the command's order, changed resting orders, ordered
  executions, and an optional cancellation reason. `Execution` identifies both
  maker and taker orders. These are internal facts for future settlement, not
  public market-data records.
- `get_order`, `get_order_book`, and `list_executions` return immutable snapshots.
  Book levels aggregate remaining quantities, bids descending and asks ascending;
  empty sides are empty tuples. Sequence advances once per effective command.
  Rejections and terminal cancellations do not advance it. Observation timestamps
  are UTC; execution IDs are stable and unique within one engine instance.
- `OrderSnapshot.quantity - filled_quantity` is unexecuted quantity. On a
  cancelled order it is cancelled remainder, not resting liquidity.

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
cancel-newest self-trade prevention. Cancel-newest is our fixed policy rather
than Coinbase's default decrement-and-cancel. Our limit-only, sequential,
single-instrument scope deliberately simplifies the reference.
