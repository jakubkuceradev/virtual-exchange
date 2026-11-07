---
type: Requirements
title: Participant Website
---

# Participant website

The website serves both casual browser traders and serious API-driven
competitors. It needs a competition dashboard and an interactive trading
interface; the exact MVP feature set remains under discussion.

## Audiences and experiences

- Casual participants and amateurs should have a fun, interactive experience
  trading through the browser.
- Serious contenders primarily trade through the API and visit the website to
  inspect their results and compare themselves with other participants.
- The dashboard should clearly visualize a participant's status, money, profit,
  and statistics, alongside competition comparisons. Initial presentation
  requirements are below; calculation rules remain open.
- The overview should give personal financial performance and competitive
  standing equal prominence. Exact layout and comparison metrics remain open.

Competition calculations belong to the website backend and consume published
exchange observations. See [competition and rankings](/competition.md) and
[public interfaces](/public-interfaces.md). API-driven participants should not
need browser trading to participate.

## Visual MVP and delivery direction

The current feature focuses on website visuals with backend interactions largely
mocked. The first PR should provide HTML mocks for design evaluation. A likely
second round will introduce a frontend framework and an unstyled component
library, applying the reviewed mocks' styling to the components. Framework and
library choices remain open; production backend integration is a later concern.

The first HTML mocks should be slightly interactive: clickable navigation,
leaderboard period switching, and sample order submission/cancellation with
visible feedback. Charts and financial values use fixed sample data; a full
exchange simulation is unnecessary. Styling and layout are the primary design
review criteria.

The first design review includes four views: Overview, Trade, Leaderboard,
and API / Account. Use a sample signed-in participant; login and registration
screens are deferred. The initial scope is one fictional asset against fictional
cash. The interface is English only initially.

## Visual direction

The look should be largely inspired by the current
[Prague Quant Club website](https://praguequantclub.org/). Keep branding minimal
overall; club branding is allowed. Neutral labels such as Trading or Trading
Hackathon are also suitable, without requiring a neutral product identity.
Use balanced density: a complete trading view, readable spacing, and restrained
decoration. Use candlesticks for market prices and a line chart for personal
performance.

## API / Account view

Include display name and account ID; a sample API credential with a copy action
and mocked create/revoke controls; and a getting-started area with an API
documentation link and a short example request. These illustrate the experience
without choosing the real authentication mechanism. Credential controls use
dummy data only; exact mock feedback remains open.

## Visibility

The order book is public. Participants cannot directly access other participants'
individual trades or trade histories. This does not decide whether the website
shows an anonymous market-wide trade feed. Published exchange execution data
may identify maker/taker orders, following Coinbase, without revealing their
owners. This does not add a trade-feed panel to the agreed website mock scope.
Competitor comparisons expose rank
and summary performance only; other participants' holdings remain private.

## Trading view

Show the complete trading view by default: a price chart, public order book,
buy/sell form, and the participant's own open orders and fills. Do not hide
these behind a simplified default or an expandable advanced mode.

The website MVP offers limit orders only: choose buy or sell, enter a limit price
and quantity, and submit. Unfilled quantities remain open and can be cancelled.
Do not offer market orders or a separate buy/sell-now action. Explain the price
constraint as buying at the limit or lower, or selling at the limit or higher;
a crossing limit order can execute immediately without losing that protection.
This sets website scope, not the remaining exchange-wide matching and recovery
rules. Exact layout and validation/feedback remain open.

## Dashboard content

Include total account value, available cash, asset holdings, profit expressed
in cash and percentage, and a personal performance chart. Give competitive
standing equal prominence through current rank, nearby competitors, and a
leaderboard with continuous, weekly, monthly, and yearly views.

These are confirmed presentation requirements. Valuation, profit baselines,
ranking formulas, and period boundaries remain provisional; illustrative mock
values do not establish competition rules.

## Responsive design

Design for desktop first, with usable mobile layouts. On phones, stack the
complete trading view vertically rather than remove features. Exact breakpoints
and section ordering remain open.

## Open questions

- Valuation, profit baselines, scoring, eligibility, and period boundaries.
- Whether an anonymous market-wide trade feed belongs in a later iteration.
- Production joining, account access, credentials, and public/guest access.

Exact layout, chart ranges, order-book depth, and mock feedback can be refined
during design review without settling production policies.

The main checkout's frontend remains a placeholder. In the dedicated website
worktree, `feat/website-frontend` at inspected commit `d664f79` contains a
React/TypeScript/Vite foundation with unstyled Mantine and a sample-data account
overview. Approved four-view HTML mocks are retained under `design/`; conversion
of the complete trading view and live exchange integration remain work. The
website backend in that branch is still health-only. These are branch-specific
observations, not a claim that the full website is implemented on main.
