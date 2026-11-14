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
website/backend/      Independent API: health and the competition service
website/frontend/     Browser experience; placeholder
```

The website backend consumes published exchange APIs/data. It imports no exchange
implementation and reads no exchange database. The exchange has no dependency on
competition or website code. Bots are external exchange API clients.
The backend uses an independent FastAPI/Uvicorn package, tests, lockfile, and
image. The frontend stack remains deferred.

## Exchange interfaces

The app owns an Authenticator and optional configured Exchange. See
[authentication](/authentication.md) and [funded trading](/trading-slice.md)
for the complete contracts, configuration, permissions and recovery.

| Module | Implemented contract |
| --- | --- |
| virtual_exchange.api | create_app(authenticator=..., exchange=...); health, identity, funded REST and /ws observations |
| virtual_exchange.auth | Authenticator authenticates opaque tokens; require_permission enforces independent read/trade/publish_news/observe_accounts grants |
| virtual_exchange.exchange | Exchange instance exposes complete funded submit/cancel, consistent account/public queries and the observe_accounts listing |
| virtual_exchange.exchange.matching | Balance-independent single-instrument sequential matching; not an unfunded participant API |
| virtual_exchange.exchange.news | NewsLog validates and orders immutable news; Exchange.publish_news/list_news serialize and deliver it |
| virtual_exchange.trading_api, news_api, stream_api | Transport parsing, serialization and error mapping; no private reserve/match/settle coordination |

Exchange commands check grants and ownership, reserve, match and settle against a
private candidate before committing. Submit returns Acceptance, not final fills;
query OrderSnapshot, Fill and Balance separately. Public Trade includes maker/taker
exchange IDs without owner IDs and the maker's side. LimitOrder and OrderSnapshot
carry TimeInForce (GTC/IOC); Exchange takes an optional per-account Funding
mapping (funded/unlimited) that only operator configuration supplies. Client UUIDs remain distinct from exchange IDs;
accepted UUIDs deduplicate per account/process via conflict and lookup, not replayed
success responses. Legacy module-level market_data functions are still unsupported;
use the app-owned Exchange observations. Module-level trading stubs were removed.

Canonical immutable standard-library records live in virtual_exchange.types,
including LimitOrder, Acceptance, Cancellation and AccountSnapshot. Prices and
quantities use Decimal and transport decimal strings. Pydantic schemas stay in
HTTP adapters. Types never import callable interfaces. Initializers contain only
documentation, imports/exports and metadata; absolute imports are required, with
__all__ restricted to __init__.py. Matching and funded arithmetic share one exact
conversion owner; balances and private observations are not public payloads.

## Website interfaces

| Boundary | Intended input | Intended output and ownership |
| --- | --- | --- |
| Backend | Website requests and published exchange observations | Participant-facing API, valuation, period baselines, eligibility, and continuous/weekly/monthly/yearly rankings, implemented from `GET /accounts` and public market data ([competition](/competition.md)). |
| Frontend | Browser interactions and website-backend responses | Participant views and competition presentation. Browser trading/data routing and framework remain undecided. |

The website backend distinguishes public market feeds from authorized account
balances, orders, and fills. Rankings use the exchange's `observe_accounts`
listing and keep their own observations in the backend's store. Exchange
publishes facts, not competition scores or calendar baselines. Accounts continue without resets.

## Intended flow

```text
Trading clients -> exchange API -> authentication -> complete trading operation
Exchange published market/account data -> website backend -> website frontend
```

Authentication establishes trusted account IDs; complete trading operations enforce
permissions and ownership. The backend health app remains independent of exchange
imports/network dependencies; website integration and competition are deferred.

See [development setup](/development.md) for commands and
[architecture principles](/architecture-principles.md) for the design rationale.
