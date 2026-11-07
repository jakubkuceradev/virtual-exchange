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
website/frontend/     Four-view React preview and approved HTML design reference
```

The website backend consumes published exchange APIs/data. It imports no exchange
implementation and reads no exchange database. The exchange has no dependency on
competition or website code. Bots are external exchange API clients.
The backend uses an independent FastAPI/Uvicorn package, tests, lockfile, and
image. The frontend preview uses React + TypeScript + Vite with
HeadlessMantineProvider and custom CSS Modules. Overview, Trade,
Leaderboard, and API / Account use typed fixture state, accessible SVG charts,
hash navigation, and headless controls. No service calls or persistence are added.
The [frontend integration map](../website/frontend/INTEGRATION.md) distinguishes
mocked backend data/commands, provisional frontend assumptions, and implemented
UI behavior. Matching source annotations must be updated as each real API
responsibility replaces its mock; visual completeness does not imply integration.

**Live trading routing (implemented).** The frontend calls the exchange's
published REST and WebSocket APIs through same-origin `/exchange/*` paths (the
WebSocket at `/exchange/ws`); the Vite dev/preview server forwards them to
`EXCHANGE_URL` (default `http://127.0.0.1:8000`), read on the Node side and never
compiled in. No website-backend business API sits in this path. Participants
enter an existing exchange token, which stays in tab memory only (no web storage,
cookies, URL, or compiled secret). Public market data is visible before
connecting. Live mode is the default build; `--mode mock` keeps the disposable
demo for design work. Live mode shows unavailable states for valuation,
performance, rankings, and credential management rather than fixtures.
Competition data will still come from the website backend once it exists.
See the [frontend integration map](../website/frontend/INTEGRATION.md).

## Exchange interfaces

The app owns an Authenticator and optional configured Exchange. See
[authentication](/authentication.md) and [funded trading](/trading-slice.md)
for the complete contracts, configuration, permissions and recovery.

| Module | Implemented contract |
| --- | --- |
| virtual_exchange.api | create_app(authenticator=..., exchange=...); health, identity, funded REST and /ws observations |
| virtual_exchange.auth | Authenticator authenticates opaque tokens; require_permission enforces independent read/trade grants |
| virtual_exchange.exchange | Exchange instance exposes complete funded submit/cancel and consistent account/public queries |
| virtual_exchange.exchange.matching | Balance-independent single-instrument sequential matching; not an unfunded participant API |
| virtual_exchange.trading_api, stream_api | Transport parsing, serialization and error mapping; no private reserve/match/settle coordination |

Exchange commands check grants and ownership, reserve, match and settle against a
private candidate before committing. Submit returns Acceptance, not final fills;
query OrderSnapshot, Fill and Balance separately. Public Trade includes maker/taker
exchange IDs without owner IDs. Client UUIDs remain distinct from exchange IDs;
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
| Backend | Website requests and published exchange observations | Participant-facing API, valuation, period baselines, eligibility, and continuous/weekly/monthly/yearly rankings. The health example is implemented; scoring and participant routes are not. |
| Frontend | Browser interactions; exchange REST/WebSocket via a same-origin proxy for trading and account state; website-backend responses for competition data (planned) | Four React/headless Mantine views over one data source: live exchange (default) or the fixture demo (`--mode mock`); independent approved HTML reference. |

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

Authentication establishes trusted account IDs; complete trading operations enforce
permissions and ownership. The backend health app remains independent of exchange
imports/network dependencies; website integration and competition are deferred.

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

Root Compose starts both independent APIs.

See [development setup](/development.md) for commands and
[architecture principles](/architecture-principles.md) for the design rationale.
