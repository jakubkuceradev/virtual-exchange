---
type: Requirements
title: Live Website Exchange Integration
---

# Live website exchange integration

The next integration feature connects the mocked React website to the exchange
REST/WebSocket interfaces so that two people can each launch the website and trade
against each other on one shared exchange. It does not expand either branch's
original implementation scope.

## Agreed scope

- Connect using an existing API token and show authenticated identity.
- Make the complete Trade view live: market book/chart, limit-order submission,
  cancellation, own orders/fills, and actual available/reserved balances/holdings.
- Submit/cancel over REST; observe market and private activity over WebSockets.
- Handle snapshots, connection loss, uncertain submissions, reconciliation, and
  development-server resets without inventing fills or duplicating orders.
- Derive market candles from real retained trades. Before trading, show an empty
  state rather than synthetic prices/history.
- Keep the reviewed desktop/mobile frontend design.

Profit calculations, portfolio valuation, personal performance history, rankings,
registration, email authentication, and live token management remain separate.
Keep the token in tab memory only; reload requires entry again, and disconnect
clears credentials/private state. Use same-origin HTTP/WebSocket proxy routing
to the exchange without adding website-backend business logic. Signed-out users
may view the public book/chart. In live mode, unimplemented dashboard/ranking
and credential-management features show unavailable states; never substitute
fixture data or fake successful actions. Existing mocks remain available for
isolated design/development work.

## Parallel development and acceptance

Both the frontend and exchange stacks are still unreviewed. The integration work
builds on a per-need integration branch that merges both stack tips onto `main`,
and opens draft PRs against it; after both stacks merge, it is rebased onto `main`
for review. The integration branch itself is never merged. Final acceptance must
run against the real exchange from that combined checkout and demonstrate
two isolated browser sessions placing real crossing orders, observing consistent
fills/balances, cancelling a remainder, and recovering after disconnection/reset.

See [participant website](/website.md), [funded trading slice](/trading-slice.md),
and [authentication](/authentication.md). Detailed behavioral specification lives
outside the checkout under the project's local specs directory.
