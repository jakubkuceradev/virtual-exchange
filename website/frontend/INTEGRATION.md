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
state), asynchronous order commands, `competition` — standings per period and
the caller's own valuation and history, from the website backend in live mode —
and `samples`, fixture data for features with no real source yet (API key
management). Amounts are decimal strings handled by
[src/trading/decimal.ts](src/trading/decimal.ts); floating point is used only
for chart geometry and percentages.

| Module | Status |
| --- | --- |
| [trading/mock.ts](src/trading/mock.ts) / `useMockSource` | Mock source: adapts the [demo.ts](src/demo.ts) simulation and fixtures, converting cents/whole units to decimal strings at the boundary, and fixture standings/history into the `competition` shape. Selects the `no-trades` scenario. |
| [demo.ts](src/demo.ts) / `createDemo` | Mock backend simulation (matching, self-trade prevention, reservations, settlement, cancellation, validation, dummy keys). Never production exchange logic. |
| [fixtures.ts](src/fixtures.ts) | Fabricated observations: identity, balances, book, candles, performance, rankings. |
| [trading/context.tsx](src/trading/context.tsx) | Installs one source at the root; the build mode (`--mode mock` or live) picks it and it never switches at runtime. |
| [live/source.ts](src/live/source.ts) / `useLiveSource` | Live source over one `LiveSession` (same-origin `/exchange` proxy) and one `CompetitionFeed` (same-origin `/website` proxy to the website backend). |
| [live/competition.ts](src/live/competition.ts) | Competition feed: polls the public leaderboard every 15 s and, while an identity is known, the caller's `/competition/me` (and their series every 10 minutes) with the in-memory token. Failure or standings older than 3 minutes give the unavailable state; late replies from an earlier token are dropped. |
| [live/session.ts](src/live/session.ts) | Public (book, trades), public news (separate socket, so a news gap never marks the market stale) and private (orders, fills) subscriptions; subscribe-then-fetch recovery; generation guards against late replies; bounded backoff; heartbeat deadline; process-reset handling; token in memory only. |
| Commands (in [live/session.ts](src/live/session.ts)) | Submit/cancel over REST: increment validation, one UUIDv4 per deliberate action, busy/unresolved/rejected outcomes from stable codes, lookup by client ID after an ambiguous reply (never an automatic resubmit), dismissal only after a resync also misses it, cancel races resolved by reading the order, coalesced balance refresh. |
| [live/protocol.ts](src/live/protocol.ts) | Frame assembler: subscription baselines, fragments, book snapshot brackets, per-channel sequences, heartbeat gap checks, process identity. |
| [live/market.ts](src/live/market.ts), [live/account.ts](src/live/account.ts) | Pure reducers: book levels, deduplicated trades, candles/statistics from executions only; versioned orders, deduplicated fills, commit-ordered balances. |
| [live/news.ts](src/live/news.ts) | Pure feed rules: the `GET /news` page at the subscription baseline plus buffered channel items above it, newest first, deduplicated by `news_id`. |
| [live/rest.ts](src/live/rest.ts), [live/wire.ts](src/live/wire.ts) | REST client with outcome classification and cursor paging; wire decoders. |

## Views and components

| Component | Source-backed | Sample-only (`samples`) |
| --- | --- | --- |
| `App` / `Dashboard` | Header identity, navigation, focus | — |
| `Overview` | Available/reserved cash, holdings, market card; valuation, profit, performance chart, rank and nearby standings (website backend) | Holdings-card valuation note (mock only) |
| `Trade`, `OrderTicket`, `BookRows`, `OrderRows`, `FillRows` | Everything: instrument units, statistics, candles, book, balances, orders, fills, commands, disabled states | — |
| `News` | Everything: items newest first, tags, body, event time and countdown, feed status; unread count in `Dashboard` | — (the mock source supplies sample items) |
| `CandleChart` | Candles with computed scales and labels | — |
| `PerformanceChart` | Live series with computed scale and dates | Fixed sample scale and labels (mock) |
| `Leaderboard`, `Nearby`, `RankingRows` | Public standings; the caller's rank, return and neighbourhood when signed in; unranked reasons; unavailable state | — |
| `Credentials` | Unavailable state when `samples` is null | Dummy key create/revoke |
| `Account` | Identity, account ID, market, connection status | Example request and API notes are provisional |

When `samples` is null (the live source), sample-only features render explicit
unavailable states; they never fall back to fixtures. Likewise a loading,
failed or stale `competition` renders the existing unavailable states.

Run the website backend with competition enabled for live rankings (see
`wiki/development.md#competition-service`); set `WEBSITE_BACKEND_URL` for the
dev/preview server when it is not `http://127.0.0.1:8001`.

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
