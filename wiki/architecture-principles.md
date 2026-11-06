---
type: Proposal
title: Deep and Orthogonal Module Boundaries
---

# Deep and orthogonal module boundaries

Status: architecture proposal for discussion; not an approved implementation
plan. The user requested application of deep modules and orthogonality to this
project.

Prefer interfaces that hide substantial complexity and boundaries that allow
unrelated changes to stay local. Orthogonality does not remove the need for
consistent order, reservation, and settlement changes.

## Suggested starting structure

Start with one Python application and an exchange command boundary. Internal
modules can share a process and a transaction; they need not become services.
The conceptual boxes in [the overview](overview.html) represent responsibilities,
not independent transactions or deployment units.

| Boundary | Owns and hides | Example interface |
| --- | --- | --- |
| API and identity | HTTP parsing, credentials, account identity, response formatting | Translate authenticated requests to typed exchange commands |
| Exchange | Command ordering, validation orchestration, atomic order/funds/trade updates, durable acceptance, retry results | submit_order, cancel_order, account/order queries |
| Matching, internal to exchange | Price levels, queues, priority, partial fills, execution prices, self-trade rules | Process a sequenced order/cancel and produce a typed result |
| Ledger and funding, internal to exchange | Available/reserved balances, settlement arithmetic, funding eligibility | Reserve, settle, release within the exchange transaction |
| Persistence, behind exchange boundary | Transactions, record format, recovery representation | Commit a complete exchange transition and recover committed state |
| Market data | Public book/trade views and their presentation | Snapshot now; sequenced updates later |
| Competition | Valuation, period baselines, eligibility, score calculation | Rankings from committed account history and market observations |
| Private bots | Trading strategy and any internal reference prices | Use the exchange API as clients |

These are candidate responsibilities, not mandatory classes or generic plugin
interfaces. Expose operations justified by the first slice; add abstractions
when they hide real complexity. Domain contracts must still describe observable
execution, cancellation, errors, and durability precisely.

## One consistency boundary

A submitted order requires coordinated funding checks/reservations, matching,
settlement, residual order state, and persistence. Present these as one operation
to callers. An API handler must not coordinate independent reserve/match/settle
calls, and account effects must not rely on a best-effort asynchronous fill
listener.

Durable state and any outward event records must agree before success is
acknowledged. Read views may update after commit with an explicit freshness or
sequence contract; they must be recoverable from durable history or snapshots.
A projection's failure must not silently lose a completed trade.

Keep deterministic transition logic separate from HTTP, database calls, and
wall-clock access where practical. Assign sequence and accepted time at the
exchange boundary. Select an initial storage strategy before implementation;
an in-memory book and a database do not become atomic merely by sharing a
process. Failed commits and restart reconstruction need explicit behavior.

## Orthogonality checks

- Changing HTTP frameworks or authentication must not rewrite matching.
- Replacing an order-book data structure must not change API order semantics.
- Changing funding allocations or the unlimited-money policy must not change
  price-time priority. Account funding policy owns the bot exception; matching
  need not know strategy names or use an is_bot branch.
- Changing weekly scoring must not affect order acceptance or settlement.
- Adding WebSockets should reuse committed market facts rather than add a
  second matching implementation.
- Changing a bot strategy must not require exchange internals or direct database
  writes.

Share small domain contracts such as instrument, quantity, price, order ID,
trade ID, and execution result. Do not expose mutable queues, ORM models, or
internal event/storage formats as public API payloads. Avoid a generic shared
utilities module becoming the owner of business rules.

## First vertical slice

Implement only enough API, exchange processing, ledger behavior, durable
storage, and queries to demonstrate an accepted bid/ask producing a consistent
execution. Rankings and bots can follow through the boundaries above without
their complete interfaces being built in advance.

## Principle references

- [John Ousterhout, A Philosophy of Software Design (author's extract)](https://web.stanford.edu/~ouster/cgi-bin/aposd2ndEdExtract.pdf) — Deep interfaces and information hiding.
- [The Pragmatic Programmer tips](https://pragprog.com/tips/) — Orthogonality as eliminating effects between unrelated things.

The module boundaries and examples above are project-specific recommendations.
