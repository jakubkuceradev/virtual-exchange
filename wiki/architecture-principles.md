---
type: Decision
title: Public Module Boundaries
---

# Public module boundaries

The agreed scaffold separates exchange/ from website/backend/ and
website/frontend/. It outlines public interfaces; the internal matching
implementation is described in [matching core](/matching-core.md). See
[public interfaces](/public-interfaces.md) for contracts and
[development setup](/development.md) for source locations.

## Deep exchange boundary

Callers request complete order operations. The exchange will own validation,
command ordering, matching, reservations, settlement, durable acceptance, and
retry behavior behind that boundary. HTTP handlers must not coordinate private
reserve/match/settle/save steps. Public placeholders describe these expectations;
they implement none of this trading behavior yet.

Order state, balances, and executions must eventually be committed consistently
before success. Merely sharing a process does not establish atomicity. Storage,
recovery, and event delivery require a later behavioral design.

## Matching and account integration

The matching core owns book validation, matching, and cancellation independently
of balances. Future complete trading operations must validate and reserve funds
before matching, then consistently settle executions and release reservations.
HTTP handlers must not coordinate these private steps. The first milestone is
in-memory, resets on restart, and tests supplied eligible orders directly;
account integration follows separately. It establishes no crash durability or
atomicity guarantee for the future combined account/matching operation.

## Independent changes

- Credential changes belong to exchange authentication and its HTTP adapter.
- Matching and storage choices stay behind the public trading interface.
- Starting allocations and unlimited bot money are exchange funding policy.
- Valuation, scoring, and period rules belong to the website backend.
- Public market observation/delivery behavior belongs to the market-data interface.
- Website presentation changes belong to the frontend.

The website consumes published exchange data rather than importing exchange
internals or reading its database. The exchange never imports the website.
There is no shared ORM/domain library or service framework in this scaffold.

## Reversibility and information hiding

Each application owns its eventual dependencies, tests, and build configuration.
Exchange and website backend have independent runnable health scaffolds today;
frontend has no selected stack. Keep backend behavior minimal and defer frontend stack and domain schemas
until callers need them. Public interfaces can grow into deep modules without prescribing internal
classes, folders, or separate deployments.

Each policy needs one authoritative owner. Reconsider a split if implementation
requires duplicated rules or repeated caller coordination. Keep unavailable
observations explicit rather than inventing successful zero values or fake data.

## References

- [Ousterhout's software-design extract](https://web.stanford.edu/~ouster/cgi-bin/aposd2ndEdExtract.pdf)
- [The Pragmatic Programmer tips](https://pragprog.com/tips/)
