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

Starting balances are easy to change later and should not block this slice.
All discussed capabilities remain in scope, but complete ranking formulas,
the full bot population, and richer supporting features can follow later.

## Unresolved requirements

Order types, matching priority, execution-price rules, cancellation behavior,
and the minimum result/query interface remain open. A limit-orders-only first
version with resting unfilled quantities was suggested by the assistant, but
has not been accepted by the user.

See [realism and complexity analysis](/exchange-tradeoffs.md) for recommendations
on these choices. They remain proposals pending agreement.
