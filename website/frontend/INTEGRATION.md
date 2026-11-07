# Frontend integration status

The reviewed presentation is implemented over a single data-source contract.
The mock source keeps the original disposable in-memory demo; it resets on reload.

Status annotations live next to every component and at the top of each source
module. They describe individual responsibilities; an implemented renderer does
not make its mocked data source complete.

| Annotation | Meaning |
| --- | --- |
| `@mock-backend` | Backend responsibility currently simulated in the browser, or observations supplied by fixtures. Replace with real API data/commands and their loading/error states. |
| `@mock-frontend` | Provisional frontend content or assumptions used to preserve the reviewed visual: hard-coded statistics, chart metadata, example requests, precision/valuation rules. Replace or derive from confirmed contracts. |
| `@implemented-ui` | Working rendering or browser behavior. Can be retained during integration; does not claim production readiness of the surrounding feature. |

Find all marked boundaries with `rg -n '@mock-backend|@mock-frontend|@implemented-ui' src`.
These are developer-facing annotations, so the reviewed interface stays uncluttered.

## Data-source boundary

Every view reads one `TradingSource` through `useTrading()`
([src/trading/types.ts](src/trading/types.ts)). It carries identity, market
(instrument, book, last price, candles, statistics), account (cash/asset
available and reserved, own orders and fills, or an explicit unavailable
state), asynchronous order commands, and `samples` — fixture data for features
the exchange does not provide. Amounts are decimal strings handled by
[src/trading/decimal.ts](src/trading/decimal.ts); floating point is used only
for chart geometry and percentages.

| Module | Status |
| --- | --- |
| [trading/mock.ts](src/trading/mock.ts) / `useMockSource` | Mock source: adapts the [demo.ts](src/demo.ts) simulation and fixtures, converting cents/whole units to decimal strings at the boundary. Selects the `no-trades` scenario. |
| [demo.ts](src/demo.ts) / `createDemo` | Mock backend simulation (matching, self-trade prevention, reservations, settlement, cancellation, validation, dummy keys). Never production exchange logic. |
| [fixtures.ts](src/fixtures.ts) | Fabricated observations: identity, balances, book, candles, performance, rankings. |
| [trading/context.tsx](src/trading/context.tsx) | Installs one source at the root; it never switches at runtime. |

## Views and components

| Component | Source-backed | Sample-only (`samples`) |
| --- | --- | --- |
| `App` / `Dashboard` | Header identity, navigation, focus | — |
| `Overview` | Available/reserved cash, holdings, market card | Valuation, profit, performance chart, rank and nearby standings |
| `Trade`, `OrderTicket`, `BookRows`, `OrderRows`, `FillRows` | Everything: instrument units, statistics, candles, book, balances, orders, fills, commands, disabled states | — |
| `CandleChart` | Candles with computed scales and labels | — |
| `PerformanceChart` | — | Fixed sample series and labels |
| `Leaderboard`, `Nearby`, `RankingRows` | Unavailable state when `samples` is null | All rankings |
| `Credentials` | Unavailable state when `samples` is null | Dummy key create/revoke |
| `Account` | Identity, account ID, market, connection status | Example request and API notes are provisional |

When `samples` is null (the live source), sample-only features render explicit
unavailable states; they never fall back to fixtures.

## Replacing a mock

Start at the annotated command/observation owner and its consuming components.
Keep reviewed layout, styling, semantic markup, focus and clipboard behavior;
replace fixture lookups, local transitions, fixed metadata and provisional
contracts as appropriate. Add real request loading, errors, authorization and
freshness handling at the owning boundary. API results must own authoritative
balances, fills, validation and rankings; do not retain simulated success as a
fallback when a real request fails.

Remove a mock annotation only when that responsibility uses its real source and
has been verified. A mixed component keeps the remaining annotations. Update
this map alongside the implementation so API integration and visual completeness
remain distinct. The HTML `design/` folder is the frozen visual reference and is
entirely mocked; its independent code is not an application integration target.
