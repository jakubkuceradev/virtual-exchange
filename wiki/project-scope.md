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
competition, and participant-facing capabilities. The funded exchange contracts
are implemented; website/competition contracts remain separate.

A separate private repository will contain simulated bots and their special
authentication details. See [Exchange and bots](/exchange-and-bots.md).

The runnable exchange lives in exchange/. The website backend is a separate
health-only application; website/frontend/ provides a four-view React/headless
Mantine preview and approved HTML reference, both using sample data. Competition belongs to the website backend and consumes exchange data; see [public interfaces](/public-interfaces.md).

## Current status

The repository contains public-interface placeholders, a Python API scaffold,
independent exchange/backend health endpoints, exchange bearer authentication
and an identity endpoint, development
checks, CI configuration, Docker/Compose support, and project documentation.
An internal [matching core](/matching-core.md) now handles sequential in-memory
limit orders. Configured funded trading, settlement, public observations and
private live updates are implemented; competition rankings remain deferred. See
[development setup](/development.md). The overview's boxes
represent intended responsibilities, not separate deployed services.

## Conceptual responsibilities

These are responsibilities, not a prescribed internal implementation layout.
The exchange/website public boundary is agreed. See [the visual overview](overview.html).

| Responsibility | Intended role | Decision still needed |
| --- | --- | --- |
| Public API and authentication | Bearer identity and funded REST/live observations implemented | Deployment and later API expansion |
| Order book and matching | Implemented sequential in-memory limit orders; see [matching core](/matching-core.md) | Concurrency, persistence, additional order types |
| Accounts and settlement | Funded fee-free spot balances, holds and settlement implemented; operator-assigned unlimited funding | Persistence, fees |
| Market data | Expose quotes, order-book information, and trades | Data depth, history, streaming versus polling |
| Website backend: competition and rankings | Rank participants continuously and by period from exchange data | Metrics, valuation, period boundaries, eligibility, bot inclusion |
| Private bot clients | Submit orders under essentially the same trading rules, with effectively unlimited money | Other exceptions and initial liquidity policy |

Persistence, recovery, and operational requirements have not yet been specified. A public-facing website and account-registration flow have not yet been defined.

## Documentation styling

Prefer dark styling inspired by the [Prague Quant Club website](https://praguequantclub.org/):
near-black backgrounds, indigo accents, fine borders, and monospace labels.
The HTML overview remains self-contained and works offline.

## Related documentation

- [README](../README.md) — General project introduction.
- [Visual overview](overview.html) — Offline module-flow diagram, responsibility summaries, and first vertical slice.
