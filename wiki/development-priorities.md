---
type: Decision
title: Development Priorities
---

# Development priorities

Build in vertical slices. Establish a working exchange first, then expand the
other project capabilities incrementally.

## Foundation

The first implementation change establishes package structure, a runnable API
health endpoint, checks, CI, and Docker/Compose startup. Participant trading is
still pending; see [development setup](/development.md).

## First trading slice

The first milestone implements an in-memory matching core, exercised directly
with supplied eligible orders. It supports one instrument, sequential limit
orders, best-price then receipt-order priority, maker-price executions, partial
fills, cancellation, and cancel-newest self-trade prevention. State resets with
a new engine instance. See [matching core](/matching-core.md) for usage and rules.

The eventual trading slice adds funding, reservations, settlement, and
participant API access in follow-up PRs stacked above the matching core. The
core does not require accounts, website, competition, or bots.

## Unresolved requirements

Account funding and participant API behavior need a separate specification.
Starting allocations, credentials, endpoint shapes, retry behavior, persistence,
and concurrent command ordering are not settled by the matching milestone.
Complete ranking formulas and richer supporting features follow later.

See [realism and complexity analysis](/exchange-tradeoffs.md) for recommendations;
behavior beyond the agreed matching subset remains proposed.
