# Participant frontend

The first round is an interactive HTML design preview for Overview, Trade,
Leaderboard, and API / Account. It uses fixed sample observations and local
in-memory interactions. No exchange or competition backend is required.

The reviewed mocks are the baseline for **React + TypeScript + Vite with
headless Mantine**, applying the design through custom CSS. The preserved HTML
preview remains independent of the component implementation.

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

With Node.js 24 or newer, no dependency installation is needed:

```sh
node --test website/frontend/tests/demo.test.mjs
node --check website/frontend/design/app.js
```

The eight executable tests cover reservations, fill prices/quantities, partial
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
cross-browser/accessibility certification. Existing CI checks the Python apps
and containers; it does not provide frontend/browser coverage.

Source: `design/index.html` owns structure, `styles.css` owns presentation,
`fixtures.js` owns sample observations, `demo.js` owns disposable interaction
state, and `app.js` connects controls and SVG chart rendering.

See [public interfaces](../../wiki/public-interfaces.md) for application boundaries.
