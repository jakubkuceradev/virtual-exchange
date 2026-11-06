---
type: Reference
title: Public Application Interfaces
---

# Public application interfaces

The repository separates the exchange from the website. Callable source stubs
outline public responsibilities only; internal implementation structure stays
open. Only the exchange API factory and health route currently work.

## Application boundaries

```text
exchange/             Independent Python package, tests, dependencies, and image
website/backend/      Competition and participant-facing API; placeholder
website/frontend/     Browser experience; placeholder
```

The website backend consumes published exchange APIs/data. It imports no exchange
implementation and reads no exchange database. The exchange has no dependency on
competition or website code. Bots are external exchange API clients.
Website stacks, dependency manifests, tests, and builds are deferred.

## Exchange interfaces

The Python callable signatures exist, but every new operation raises
NotImplementedError without side effects. None is exposed as an HTTP endpoint.
Keyword-only arguments identify the caller's intent. Mapping request/result
envelopes and sequence query results are provisional; concrete schemas, credential
fields, error taxonomy, pagination, and synchronous/asynchronous execution will
be settled in later behavioral slices before those APIs are published.

| Public module | Intended inputs and operations | Intended outputs and failures |
| --- | --- | --- |
| virtual_exchange.api | create_app; future HTTP requests | The app is implemented with GET /health. Future routes translate requests and results. Other routes return 404 today. |
| virtual_exchange.auth | authenticate(credentials) | Identity and permissions, or authentication failure. No trading balance ownership. |
| virtual_exchange.exchange | submit_order(account_id, request_id, order), cancel_order(account_id, request_id, order_id), get_order, list_orders, list_fills, get_balances, list_instruments | Complete operation results or meaningful rejection/not-found/access failures. Never expose private reservation/matching/settlement steps to callers. |
| virtual_exchange.market_data | get_order_book(instrument_id), list_trades(instrument_id), get_ticker(instrument_id) | Public book/trade observations; explicit absence of a last price before trading. Freshness, sequence and recovery contracts remain to be defined. |

Trading ownership and consistent state changes belong behind the exchange
interface. Internal files, matching rules, funding mechanisms, and storage choices
are deliberately not scaffolded. Unlimited bot money is a future funding policy;
it gives no extra matching priority.

## Website interfaces

| Boundary | Intended input | Intended output and ownership |
| --- | --- | --- |
| Backend | Website requests and published exchange observations | Participant-facing API, valuation, period baselines, eligibility, and continuous/weekly/monthly/yearly rankings. No scoring or routes implemented. |
| Frontend | Browser interactions and website-backend responses | Participant views and competition presentation. Browser trading/data routing and framework remain undecided. |

The website backend distinguishes public market feeds from authorized account
balances, orders, and fills. Ranking calculations may need historical account
observations; their retention, access policy, and recovery/export contracts need
agreement in a later data slice. Exchange publishes facts, not competition
scores or calendar baselines. Accounts continue without resets.

## Intended flow

```text
Trading clients -> exchange API -> authentication -> complete trading operation
Exchange published market/account data -> website backend -> website frontend
```

Account IDs must eventually come from trusted authentication; passing a string
today grants no access because every stub fails. Authorization remains the
exchange interface's responsibility, not a claim established by type annotations.

The flow is planned. Placeholders do not authenticate, match, settle, publish,
or score. No event bus or extra runtime service is introduced.

See [development setup](/development.md) for commands and
[architecture principles](/architecture-principles.md) for the design rationale.
