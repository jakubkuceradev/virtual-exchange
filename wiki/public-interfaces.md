---
type: Reference
title: Public Application Interfaces
---

# Public application interfaces

**Experimental:** interfaces, record fields, and signatures are not yet finalized
and may change as the MVP behavior is implemented.

The repository separates the exchange from the website. Callable source stubs
outline public responsibilities only; internal implementation structure stays
open. Both the exchange and website backend factories and health routes work.

## Application boundaries

```text
exchange/             Independent Python package, tests, dependencies, and image
website/backend/      Independent health-only API; competition still planned
website/frontend/     Interactive HTML design preview; React conversion planned
```

The website backend consumes published exchange APIs/data. It imports no exchange
implementation and reads no exchange database. The exchange has no dependency on
competition or website code. Bots are external exchange API clients.
The backend uses an independent FastAPI/Uvicorn package, tests, lockfile, and
image. The selected frontend stack is React + TypeScript + Vite with unstyled
Mantine for the next round. The first HTML design preview is implemented; its
visual review precedes the component-based round. Use Mantine headless components
with custom styling when converting the reviewed design.

## Exchange interfaces

The Python callable signatures exist, but every new operation raises
NotImplementedError without side effects. None is exposed as an HTTP endpoint.
Keyword-only arguments identify the caller's intent. Return types are named,
immutable standard-library dataclasses, with tuples for collections, Decimal
prices/quantities, and explicit None for missing market observations. They define
field shapes, not runtime business validation. Order/credential request fields,
error taxonomy, pagination, and execution behavior remain for later slices.
Pydantic request/response validation belongs at future HTTP boundaries; core
records stay independent of the web framework.

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

Trading callable definitions live in virtual_exchange.exchange.interface;
virtual_exchange.exchange re-exports them, preserving the caller-facing imports.
Package initializers contain only documentation, imports/exports, and metadata.
Use absolute imports only; Ruff rejects relative imports in both projects.
Define __all__ only in __init__.py; callable modules import the types used by
their annotations, with no duplicate export lists.

## Typed results

| Operation | Declared result |
| --- | --- |
| authenticate | AuthenticatedIdentity |
| submit_order | SubmitOrderResult containing OrderSnapshot and Fill records |
| cancel_order, get_order | OrderSnapshot |
| list_orders, list_fills, get_balances, list_instruments | Tuples of OrderSnapshot, Fill, Balance, Instrument respectively |
| get_order_book | OrderBookSnapshot containing BookLevel records |
| list_trades | Tuple of public Trade records |
| get_ticker | Ticker, with optional quotes and optional last Trade |

Dataclasses and enums live in virtual_exchange.types, split into auth, trading,
and market_data modules. These modules depend only on the standard library and
never import callable interfaces. Interfaces import types in one direction.
The exchange package facade preserves its type re-exports; use
virtual_exchange.types for canonical type imports.
Reserve HTTP/Pydantic schemas for the transport boundary; this package contains
framework-independent records, with no internal model hierarchy. Producers will supply timezone-aware timestamps. State/enumeration
and input-validation rules remain provisional until the corresponding behavior
is implemented. Records can be constructed for examples, but stubs never return
fabricated instances. Authentication results do not contain credentials; public
trades do not contain private account/order identifiers.

## Website interfaces

| Boundary | Intended input | Intended output and ownership |
| --- | --- | --- |
| Backend | Website requests and published exchange observations | Participant-facing API, valuation, period baselines, eligibility, and continuous/weekly/monthly/yearly rankings. The health example is implemented; scoring and participant routes are not. |
| Frontend | Browser interactions and website-backend responses | Four interactive HTML design views with sample data. React + TypeScript + Vite with unstyled Mantine is selected for the next round; production browser trading/data routing remains undecided. |

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

The HTML preview in website/frontend/design runs independently with fixed fixtures
and disposable local order/credential interactions. It makes no service requests,
implements no production policies, and exposes no competitor holdings or individual
histories. The approved mock uses square-cornered boxes and
controls, subtle surface contrast, and shared borders between related panels.
Introductory headings are omitted, with original panel padding retained. Locally
bundled Space Grotesk, Inter, and JetBrains Mono align typography with the club
website. The monospace header/buttons and thin Prague Quant Club footer include
Instagram and LinkedIn links. The fictional asset is Quant Coin (QC), quoted in
EUR. Only the final mock design is included.
See [frontend review instructions](../website/frontend/README.md) for
startup, desktop/mobile screenshots, sample scenarios, and verification limits.

The integration flow is planned. Placeholders do not authenticate, match, settle,
publish, or score. The backend health example runs without exchange imports,
network calls, or an event bus. Root Compose starts both independent APIs.

See [development setup](/development.md) for commands and
[architecture principles](/architecture-principles.md) for the design rationale.
