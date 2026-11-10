---
type: Decision
title: Development Priorities
---

# Development priorities

Build in vertical slices. Establish a working exchange first, then expand the
other project capabilities incrementally.

## Foundation

The first implementation change establishes package structure, a runnable API
health endpoint, checks, CI, and Docker/Compose startup. Funded REST and WebSocket trading now follow the matching/auth foundations; see [development setup](/development.md).

## First trading slice

The first milestone implements an in-memory matching core, exercised directly
with supplied eligible orders. It supports one instrument, sequential limit
orders, best-price then receipt-order priority, maker-price executions, partial
fills, cancellation errors for terminal orders, exchange-assigned IDs separate
from optional client metadata, and decrement-and-cancel self-trade prevention.
State resets with a new engine instance. See [matching core](/matching-core.md) for usage and rules.

The funded slice implements reservations, settlement, authenticated REST and
WebSocket observations in stacked PRs; see [funded trading](/trading-slice.md). The
core does not require accounts, website, competition, or bots.

## Deferred milestones

Persistence/recovery across restarts, website integration, rankings, deposits,
withdrawals and margin remain deferred; operator-assigned unlimited funding is
implemented. Funded-slice
REST/retry/stream contracts are recorded in [funded trading](/trading-slice.md).
