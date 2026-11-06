---
type: Overview
title: Project Scope
---

# Project scope

Virtual Exchange is a [Prague Quant Club](https://praguequantclub.org/) project
for a 24/7 online hackathon in which participants trade fictional assets on a
server-hosted simulated exchange.

## Repository boundaries

This public repository should contain everything that is suitable for public
exposure. The broader scope includes the exchange, API, accounts, market data,
competition, and participant-facing capabilities; detailed interfaces remain
undefined.

A separate private repository will contain simulated bots and their special
authentication details. See [Exchange and bots](/exchange-and-bots.md).

## Current status

The repository contains a Python API scaffold, a health endpoint, development
checks, CI configuration, Docker/Compose support, and project documentation.
Order handling, matching, settlement, market data, and rankings remain
unimplemented. See [development setup](/development.md). The overview's boxes
represent intended responsibilities, not separate deployed services.

## Conceptual responsibilities

These are responsibilities to discuss, not committed services, packages, or deployment boundaries. See [the visual overview](overview.html).

| Responsibility | Intended role | Decision still needed |
| --- | --- | --- |
| Public API and authentication | Accept authenticated participant requests and expose exchange information | Transport, credentials, endpoints, limits, and bot permissions |
| Order book and matching | Maintain bids and asks and produce executions | Order types, priority rules, execution-price rules, cancellation behavior |
| Accounts and settlement | Represent balances, positions, and the effects of fills | Starting funds, asset allocation, borrowing, shorting, fees |
| Market data | Expose quotes, order-book information, and trades | Data depth, history, streaming versus polling |
| Competition and rankings | Rank participants continuously and by calendar period | Metrics, valuation, period boundaries, eligibility, bot inclusion |
| Private bot clients | Submit orders under essentially the same trading rules, with effectively unlimited money | Special authentication, funding mechanism, any other exceptions, and initial liquidity policy |

Persistence, recovery, and operational requirements have not yet been specified. A public-facing website and account-registration flow have not yet been defined.

## Documentation styling

Prefer dark styling inspired by the [Prague Quant Club website](https://praguequantclub.org/):
near-black backgrounds, indigo accents, fine borders, and monospace labels.
The HTML overview remains self-contained and works offline.

## Related documentation

- [README](../README.md) — General project introduction.
- [Visual overview](overview.html) — Offline module-flow diagram, responsibility summaries, and first vertical slice.
