---
type: Decision
title: Development Priorities
---

# Development priorities

Build in vertical slices. Establish a working exchange first, then expand the
other project capabilities incrementally.

## Foundation

The first implementation change establishes package structure, a runnable API
health endpoint, checks, CI, and Docker/Compose startup. Exchange behavior is
still pending; see [development setup](/development.md).

## First trading slice

The initial direction is an end-to-end trading flow: accept bids and asks
through the public API, match compatible orders, and expose the resulting
executions. Detailed order behavior still needs agreement before implementation.

The first milestone is an in-memory matching core, tested directly with supplied
orders. Add account funding, reservations, and settlement in PRs stacked on top
of the matching core. The eventual complete trading slice includes public API
access; the first milestone does not require it.

Resetting all state on restart is acceptable for this development milestone.
Durable acceptance and restart recovery are deferred; this does not settle the
continuous competition's eventual operational requirements.

Starting balances are easy to change later and should not block this slice.
All discussed capabilities remain in scope, but complete ranking formulas,
the full bot population, and richer supporting features can follow later.

## Agreed matching-core behavior

- One instrument, limit orders, sequential commands in supplied arrival order.
- Match best price first, then arrival order at equal prices; execute each fill
  at the matched resting order's limit price.
- Support partial fills across orders/price levels and rest unmatched quantity.
- Cancellation removes only the unfilled remainder. Unknown, filled, and
  already-cancelled IDs return an error.
- Prices and quantities must be positive and conform to configured tick/lot
  increments, using exact arithmetic. Exchange-assigned order IDs are distinct
  from optional client IDs; lifetime client-request deduplication is not promised.
- Carry owner IDs as metadata. Use Coinbase's default decrement-and-cancel
  self-trade prevention: cancel the smaller remaining quantity and decrement the
  larger by that amount, or cancel both when equal. Preserve earlier fills;
  prevented quantity is not an execution. A surviving incoming order continues
  matching, and a surviving resting order retains priority.
- Expose book/order inspection and execution results identifying both matched
  orders, price, and quantity. HTTP and concurrency support are deferred.

## Unresolved requirements

Authentication is implemented in a stacked branch; see
[authentication status](/authentication.md). Funding, reservation, and settlement
rules are now agreed in [the funded trading slice](/trading-slice.md);
authenticated trading/query and retry behavior remain to be specified.
WebSocket book/trade and private order/fill updates are now included; see the
funded trading slice for remaining stream-contract choices.
Persistence, website integration,
and rankings are outside this first slice. The inspected trading branch includes
the corrected matching implementation (`6896c68`), funded operations and REST
adapters; WebSocket work is in progress. See the funded slice's implementation
status for branch-specific evidence and outstanding contract reconciliation.

See [realism and complexity analysis](/exchange-tradeoffs.md) for recommendations
on these choices. The agreed subset is recorded above; other recommendations
remain proposals.
