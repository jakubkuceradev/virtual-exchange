# Participant frontend

React 19.3.1, TypeScript 7.0.2, Vite 8.3.6 and headless Mantine 9.7.5 (pinned in
package.json and the lockfile) implement the approved Overview, Trade,
Leaderboard and API / Account views, plus a public News view with a live unread
count in the navigation. Every view reads one data source
(`useTrading()`), selected by build mode:

- **Live** (default): connects to a running exchange through a same-origin
  proxy. Public market data shows without a token; an API token entered on the
  API / Account page unlocks your balances, orders and fills. The token stays
  in tab memory only — reload to sign out.
- **Mock** (`--mode mock`): the original disposable in-memory demo with sample
  data, for design and isolated development work.

See the [integration map](INTEGRATION.md) for which features are exchange-backed
and which exist only as samples (valuation, performance, rankings, key
management show as unavailable in live mode).

## Run against an exchange

Use Node **26.13.0 LTS** (`nvm install` / `nvm use` in this directory). Start an
exchange with private trading and token configuration (see
[funded trading](../../wiki/trading-slice.md) and
[authentication](../../wiki/authentication.md)), then:

```sh
cd website/frontend
npm ci
EXCHANGE_URL=http://127.0.0.1:8000 npm run dev   # default EXCHANGE_URL shown
```

Open <http://127.0.0.1:5173/>. The dev server forwards `/exchange/*` HTTP and
the `/exchange/ws` WebSocket to `EXCHANGE_URL`; the browser never talks to the
exchange directly and nothing is compiled into the bundle. `npm run build` and
`npm run preview` (port 4175) serve the same live app with the same proxy.

### Two participants, two machines

One operator runs the exchange reachable on the local network, with private
configuration files kept outside the checkout:

```sh
EXCHANGE_AUTH_CONFIG=/private/auth.json \
EXCHANGE_TRADING_CONFIG=/private/trading.json \
uv run --project exchange --locked uvicorn virtual_exchange.api:create_app \
  --factory --host 0.0.0.0 --port 8000
```

Each participant runs the website on their own machine and points it at that host:

```sh
EXCHANGE_URL=http://<operator-host>:8000 npm run dev
```

They open their own <http://127.0.0.1:5173/> and connect with their token. This
is unencrypted HTTP for a trusted local network only — no TLS or production
hosting. The live acceptance suite (`npm run test:live`) uses two isolated
browser contexts on one machine, which exercises the same trading behavior.

## Run the mock

```sh
npm run dev:mock        # http://127.0.0.1:5173/, no backend needed
npm run build:mock      # bundle into dist-mock/
npm run preview:mock    # inspect dist-mock/ at http://127.0.0.1:4174/
```

## Checks

```sh
npm run check          # Biome lint and formatting
npm run typecheck      # strict TypeScript, including tooling and tests
npm test               # unit tests: decimals, protocol, market/account, session, demo
npx playwright install chromium
npm run build:mock && npm run test:browser   # mock UI, desktop and mobile
npm run build && npm run test:live           # real exchange + proxy (needs uv)
```

`test:live` generates synthetic tokens and private configuration in a temp
directory, starts a fresh exchange per test on port 18000 and a live preview on
port 4176, and drives isolated browser contexts. Leave those ports free.

`src/main.tsx` owns the React root and `HeadlessMantineProvider`. Mantine CSS is
never imported: global tokens/reset live in `src/global.css`, and component
styles use CSS Modules. Mantine style props and theme color schemes are not part
of this setup. Fonts are bundled by Vite from `src/fonts/`, a copy of the
licensed local design assets, so the build does not depend on `design/`; distribution licenses are included under
`public/licenses/fonts/` and copied to the build. Biome handles lint/format independently of the
TypeScript compiler; `tsc` checks types and Vite handles bundling.

`src/live/` owns the exchange client (REST, WebSocket protocol, market/account
state, session); `src/trading/mock.ts` adapts the `src/demo.ts` in-memory model.
The four view components render the active source,
`Trading.tsx` owns the ticket/book/orders/fills controls, `Standings.tsx` owns
period controls and public summary rows, and `Charts.tsx` renders accessible SVG.
Mantine's headless buttons retain custom styles and native keyboard semantics.
Hash routes (`#overview`, `#trade`, `#leaderboard`, `#account`, and
`#account/api-docs`) support direct links and browser history. Form values,
selected period, orders, balances, and credentials survive view changes.

`?scenario=no-trades#trade` demonstrates unavailable price/history/ranking data.
Orders can rest without fabricating executions. Valuation uses the documented
sample snapshot; charts and standings stay fixed after local fills. Production
joining, authentication, trading integration, and competition policies remain
future work. The build contains only the React app, not the reference HTML mock.

## React screenshots and verification

Full-page Chromium captures at 1440 × 1000 desktop and 390 × 844 mobile:

| View | Desktop | Mobile |
| --- | --- | --- |
| Overview | [Screenshot](previews/react/desktop-overview.png) | [Screenshot](previews/react/mobile-overview.png) |
| Trade | [Screenshot](previews/react/desktop-trade.png) | [Screenshot](previews/react/mobile-trade.png) |
| News | [Screenshot](previews/react/desktop-news.png) | [Screenshot](previews/react/mobile-news.png) |
| Leaderboard | [Screenshot](previews/react/desktop-leaderboard.png) | [Screenshot](previews/react/mobile-leaderboard.png) |
| API / Account | [Screenshot](previews/react/desktop-account.png) | [Screenshot](previews/react/mobile-account.png) |

Sixteen state checks run the same eight regression scenarios against the React
model and the independent HTML reference. Twenty browser checks cover all views,
direct links/history, keyboard navigation, reservations/cancellation, partial
fills, invalid input, sell holdings, periods, real clipboard copy and denied-copy
fallback, credential lifecycle, and missing observations. Page overflow is checked
at 320, 390, 820, 1024, and 1440px. Evidence is local Chromium execution with
fixtures; real backend integration and other browsers have not been verified.

## Reviewed HTML mocks

Overview, Trade, Leaderboard, and API / Account use fixed sample observations and
local in-memory interactions. They run independently of React and remain
available as the visual and interaction reference.

## Open the design preview

From the repository root, with Python 3 installed:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory website/frontend/design
```

Open <http://127.0.0.1:4173/>. Navigation links support direct URLs such as
<http://127.0.0.1:4173/#trade> and browser back/forward. Reload to reset all demo
interactions; nothing is saved. Ctrl+C stops the server. Assets are local and
the Space Grotesk, Inter, and JetBrains Mono fonts are bundled locally with
their OFL licenses. The preview makes no runtime font requests to external sites.

Review missing-observation/empty states at
<http://127.0.0.1:4173/?scenario=no-trades#trade>. Missing last price, candles,
book spread, fills, performance history, and rankings are explicitly unavailable.
Orders can still rest in this scenario; submitting does not invent an execution.

## Final mock design

Boxes and controls have square corners, with subtle surface contrast. Related
sections share outer boxes and internal borders. Introductory headings are
omitted, while panel padding is retained. The header and buttons use the club
site's monospace treatment, panel titles use bold Space Grotesk, and labels are
unframed. The thin footer links Prague Quant Club, Instagram, and LinkedIn.
Only the final approved mock is included.

## Design review

The look draws from [Prague Quant Club](https://praguequantclub.org/): near-black
surfaces, indigo accents, fine borders, and monospace labels. The four views use
restrained branding and one fictional Quant Coin market, quoted as QC / EUR. Overview gives personal
performance and competition equal desktop panel widths. On mobile, Trade stacks
chart, ticket, public book, own orders, and own fills. Wide order tables scroll
inside their panels so every field and the Cancel action remain available.

Screenshots captured in Chrome at **1440 × 1000** and **390 × 844** viewports
show the full pages, including below-the-fold content:

| View | Desktop | Mobile |
| --- | --- | --- |
| Overview | [Screenshot](previews/desktop-overview.png) | [Screenshot](previews/mobile-overview.png) |
| Trade | [Screenshot](previews/desktop-trade.png) | [Screenshot](previews/mobile-trade.png) |
| Leaderboard | [Screenshot](previews/desktop-leaderboard.png) | [Screenshot](previews/mobile-leaderboard.png) |
| API / Account | [Screenshot](previews/desktop-account.png) | [Screenshot](previews/mobile-account.png) |

Review layout, readability, chart/table density, and the prominence of financial
performance versus competitive standing. The design has been approved as the
baseline for the component implementation.

### Try the interactions

1. Open Trade. The initial 50 QC buy at 110 EUR is open; 5,500 EUR is reserved.
   Available cash is 70,950 EUR, with 480 QC held.
2. Submit the default buy of 10 QC at 110 EUR. It stays open without creating
   a fill. Cancel it to release its reservation.
3. Buy 10 QC at **112.70 EUR**. Six fill at the sample ask of 112.60 EUR; four
   remain open. Cancel the remainder. This leaves the completed fill intact.
4. Reload, then buy **2 QC at 112.60 EUR** for a completely filled order.
   Switch to Sell to see the limit-price floor and available asset holdings.
5. Try a zero price, fractional quantity, or an order larger than your available
   cash/holdings. Field feedback explains the problem without changing state.
6. Visit Leaderboard and switch all four periods. Each selects a fixed set of
   sample ranks/returns. Participants expose rank, name, and summary return only.
7. Visit API / Account. Copy, revoke, and recreate the dummy key. Copy uses the
   browser clipboard where available and selects the text for manual copying
   if permission is denied. Provisional API notes are linked within the view.
8. Navigate using the keyboard and review the full Trade view on a phone,
   including horizontal scrolling to the cancellation controls.

## Scope of the sample data

- All money, holdings, identities, credentials, history, and rankings are fixtures.
  Prices and cash use integer cents; the demo accepts whole QC units only.
  This precision is illustrative, not a production instrument rule.
- The initial account has 76,450 EUR total cash and 480 QC. For design coherence,
  account cards value QC at a fixed **112.50 EUR** and compare against an
  illustrative 100,000 EUR starting value: 130,450 EUR total, +30,450 EUR / +30.45%.
  Production valuation and profit baselines remain unresolved.
- Submissions consume available sample bid/ask levels within the limit, record
  only those executions, and leave remaining quantity open and cancellable.
  Open orders reserve cash at the buy limit or units for sells. Other open
  orders are not automatically matched when new orders are submitted. There
  are no fees, persistence, network commands, or complete exchange simulation.
- Account cards, available resources, orders, fills, last execution, and displayed
  book liquidity reflect local interactions. Charts, snapshot market statistics,
  and competition standings remain fixed observations. New execution times
  advance from a fixed sample session clock, not the reviewer's local time.
- Rankings for continuous/weekly/monthly/yearly views are independent fixtures.
  They establish no scoring, eligibility, valuation, or calendar-boundary policy.
  Competitor holdings and individual histories are never exposed.
- The API example deliberately uses `example.invalid` and a dummy key. The URL,
  fields, and authorization header are provisional; neither Python application
  exposes a trading HTTP API. Production authentication remains undecided.

## Focused checks

With the pinned Node.js runtime, no dependency installation is needed for the
state-only checks:

```sh
node --test website/frontend/tests/demo.test.mjs
node --check website/frontend/design/app.js
```

The shared state scenarios cover reservations, fill prices/quantities, partial
and complete execution, sell limits, cancellation, rejection without mutation,
exhausted liquidity, and dummy credential lifecycle. Run the test file directly
with `node website/frontend/tests/demo.test.mjs` to see every named assertion group
on Node versions whose isolated runner summarizes only the file result.

Browser verification used local Chrome against the actual static page: order
flows and feedback, all periods, real clipboard copy plus simulated clipboard
rejection, credential lifecycle, keyboard navigation, deep links/back navigation,
reduced motion, and no-trades states. All four views were checked for page
horizontal overflow at 320, 390, 820, 1024, and 1440px; desktop/mobile screenshots
were inspected. This is local browser evidence, not real backend integration or
cross-browser/accessibility certification. The frontend CI runs the shared state scenarios and the React interaction
checks; it does not automate the complete HTML reference browser flow.

Source: `design/index.html` owns structure, `styles.css` owns presentation,
`fixtures.js` owns sample observations, `demo.js` owns disposable interaction
state, and `app.js` connects controls and SVG chart rendering.

See [public interfaces](../../wiki/public-interfaces.md) for application boundaries.
