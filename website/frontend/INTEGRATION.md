# Frontend integration status

The reviewed presentation is implemented. **No participant-facing feature is
connected to a real API yet.** The browser never submits orders, retrieves market
or competition data, authenticates a participant, or manages real credentials.
The running interactions use disposable in-memory state and reset on reload.

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

## Views and components

| Component | Mocked now / integration still required | Implemented UI to retain |
| --- | --- | --- |
| `App` / `Dashboard` ([App.tsx](src/App.tsx)) | Always installs `DemoProvider`; header identity and signed-in state are fixtures. No login, session validation, or authorization. | Hash routing, direct links, history, focus/skip link, header, club/social footer. |
| `Overview` ([Overview.tsx](src/Overview.tsx)) | All account/market/competition observations. Fixed valuation, baseline, profit calculations, rank and participant count. | Metric/panel layout, responsive grouping, view links. |
| `Trade` ([Trade.tsx](src/Trade.tsx)) | Market/account session; fixed change/high/low/volume, instrument metadata, interval/date. | Complete chart/book/ticket/orders/fills composition and mobile stacking. |
| `Leaderboard` ([Leaderboard.tsx](src/Leaderboard.tsx)) | Periods select local ranking fixtures; count, ranks and returns are sample observations. | Selected-period state, persistence across navigation, layout and status announcement. |
| `Account` ([Account.tsx](src/Account.tsx)) | Profile and signed-in status; provisional request URL, auth scheme, payload and documentation. | Profile layout and working documentation anchor. |
| `PerformanceChart` / `CandleChart` ([Charts.tsx](src/Charts.tsx)) | Fixed series and demo availability; hard-coded axes, dates/times, current-price marker and descriptions. | Accessible SVG rendering. Update metadata/scales/descriptions together with real series. |
| `EmptyChart` ([Charts.tsx](src/Charts.tsx)) | No behavior is simulated here; callers currently choose availability from the demo scenario. | Empty-state rendering from supplied text. |
| `Nearby` / `RankingRows` ([Standings.tsx](src/Standings.tsx)) | Fixture availability/identity and sample rows supplied by the parent. | Summary-only row rendering and current-participant highlight. |
| `PeriodControls` ([Standings.tsx](src/Standings.tsx)) | No behavior is simulated here; the parent currently resolves selection to fixtures. | Controlled buttons and keyboard behavior. |
| `OrderTicket` ([Trading.tsx](src/Trading.tsx)) | Submission, resources and results; whole-unit/two-decimal precision, limits and validation assume demo rules. No real request, pending state or server errors. | Controlled inputs, Buy/Sell selection, labels, field feedback/focus, estimate display. Bind precision/validation to actual instrument and server contracts. |
| `BookRows` ([Trading.tsx](src/Trading.tsx)) | Local bid/ask levels; no snapshot/stream, freshness, sequence or reconnect handling. | Public depth-row rendering. |
| `OrderRows` ([Trading.tsx](src/Trading.tsx)) | Own order history and cancellation result; no order API or concurrency handling. | Table rendering, cancel affordance, focus after cancellation. |
| `FillRows` ([Trading.tsx](src/Trading.tsx)) | Own execution records; no fills API or live updates. | Table rendering. |
| `Credentials` ([Credentials.tsx](src/Credentials.tsx)) | Dummy key state and create/revoke commands/feedback. No real credential storage or authentication scheme. | Actual browser clipboard, selectable manual-copy fallback, disabled states, focus recovery. |

## Modules and service boundary

| Module | Status / replacement boundary |
| --- | --- |
| [fixtures.ts](src/fixtures.ts) | Entirely mocked observations/identity and visual assumptions. Its local records are not backend transport contracts. |
| [demo.ts](src/demo.ts) / `createDemo` | Mock backend simulation: matching, reservations, settlement, cancellation, funding, validation, fixed session clock and dummy credential lifecycle. Replace with API commands/results; do not reuse it as production exchange logic. |
| [DemoContext.tsx](src/DemoContext.tsx) / `useSession`, `DemoProvider`, `useDemo` | Mock session adapter: publishes React snapshots from the simulation and selects the `no-trades` scenario. Replace with ownership of authenticated account, market, competition and credential requests/state. |
| [main.tsx](src/main.tsx) | Implemented entry point, headless Mantine provider and local fonts/styles. Its child `App` still composes the mock provider. |
| [styles.ts](src/styles.ts) | Implemented class composition and display formatting; no simulated data or commands. |
| [global.css](src/global.css), [App.module.css](src/App.module.css) | Implemented reviewed presentation, responsive styles and header blur. No service behavior. |
| [website backend API](../backend/src/pqc_website/api.py) | Real `/health` route in this branch, not a mock participant API. Account/market/competition/credential routes are absent. The frontend does not call it. |

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
