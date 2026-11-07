# Wiki Update Log

## 2026-11-07

* **Deployment target**: Planned GHCR-published ARM64 images (exchange, website with same-origin API/WebSocket forwarding, website backend) run by Compose on the shared VM behind Caddy and Cloudflare. `main` pushes publish `:main`; manual runs publish branch tags for test deploys. VM pulls stay manual.

* **Integration delivery base**: Browser integration now builds on a per-need branch merging the unreviewed frontend and exchange stacks, with draft PRs rebased onto `main` once both merge. Outcome restated as two people launching the website and trading against each other on one shared exchange.

* **Browser integration spec complete**: Confirmed tab-memory-only tokens, same-origin exchange proxy routing, signed-out public market viewing, and unavailable states for unimplemented live features. No fixture fallback in live mode; behavioral scope is ready for architecture handoff.

* **Browser integration scope**: Established token authentication, live Trade view, actual balances/holdings, and snapshot/reconnect/reset behavior as the next frontend-stacked integration feature. Assumes completed frontend/exchange contracts; valuation, rankings, registration, and email delivery stay separate. Browser-storage/routing/guest/demo choices remain open.

* **Integration readiness**: Inspected feature branches: corrected matching and authentication are present, funded REST trading is committed, WebSocket work is uncommitted, and the website has a React foundation with sample data plus approved HTML designs. Updated branch-specific status; live trading UI, browser access/routing, and end-to-end verification remain integration work.

* **Trading transport**: Confirmed the Coinbase-like split: REST order submission/cancellation and queries, WebSocket market/private activity updates. WebSocket order commands and FIX are outside the current milestone.

* **Live trading updates**: Included WebSockets for public book/trade and private order/fill updates in the first end-to-end trading slice, alongside REST commands and queries. This supersedes the earlier streaming exclusion; delivery/recovery/authentication details remain under specification.

* **Funded trading rules**: Agreed configured starting allocations restored on restart, fully funded spot trading without fees/borrowing/shorting, ordinary bot accounts, pre-order reservations, immediate settlement, and reservation releases for savings/cancellations/self-trade prevention. Trading/query and retry contracts remain open.

* **Authentication delivered**: Verified bearer authentication, hashed configuration, permission checks, and `/identity` on the stacked authentication branch. Funding/reservations/settlement and authenticated trading/query endpoints remain separate specification work; persistence, streaming, website integration, and rankings stay outside the first end-to-end slice.

* **Authentication spec complete**: Confirmed no automatic token expiry in v1 and multiple independently permissioned tokens per account. Individual token replacement/removal takes effect on restart without invalidating other configured tokens. Behavioral scope is ready for architecture handoff.

* **Authentication scope**: Agreed operator-provisioned bearer tokens, read/trade grants, restart-loaded private configuration, shared participant/bot authentication, and an identity endpoint; website login is deferred. Email-delivered reusable authentication tokens are a possible v2, with lifecycle and email-to-identity rules still open.

* **Coinbase behavioral alignment**: Adopted default decrement-and-cancel self-trade prevention, errors for terminal cancellation, distinct client/exchange IDs, acceptance acknowledgments, and anonymous public order linkage. Authentication remains independent. Updated provisional-interface expectations without expanding the matching-first milestone.

* **Coinbase comparison**: Verified matching alignment and documented differences in terminal cancellation, self-trade defaults, IDs/retries, acknowledgment semantics, public execution linkage, book depth, credentials, and streaming. Public documentation does not establish Coinbase's internal architecture or crash guarantees; agreed project behavior is unchanged.

* **Technical reference**: Selected official Coinbase Exchange documentation as a primary reference for technical choices. Cite relevant behavior and record deliberate departures; project scope takes precedence and API compatibility is not implied.

* **Execution price**: Selected the matched resting order's limit price for each execution in the matching core.

* **Matching rules**: Accepted price-time priority, partial fills/resting remainders, cancellation outcomes, exact tick/lot validation, lifetime duplicate-ID rejection, owner-based self-trade prevention, sequential commands, and book/order/execution inspection. Execution price remains under discussion.

* **Matching-first delivery**: Selected a standalone in-memory matching core tested with orders as the first milestone, with account integration in stacked PRs. Clarified the narrow matching/account outcome contract and retained the eventual complete trading-operation boundary.

* **Minimal exchange milestone**: Established a simple in-memory limit-order book and matching as the first trading milestone. Reset-on-restart is acceptable; durability is deferred while in-process consistency remains required. Detailed trading rules are still under discussion.

* **Visual MVP defaults**: Confirmed one asset against fictional cash, signed-in mocks with login/registration deferred, candlestick market and line performance charts, private competitor holdings, balanced density, and English. Branding should be minimal overall; club branding is allowed.

* **API / Account content**: Confirmed display name/account ID, sample credential and copy/create/revoke controls, and documentation/example request for the visual mock. Real authentication remains undecided.

* **Website mock views**: Confirmed Overview, Trade, Leaderboard, and API / Account for the first design review. Account-screen content and login/registration scope remain open.

* **HTML mock interactions**: Confirmed lightweight navigation, leaderboard period switching, and sample order submit/cancel feedback with fixed chart/financial fixtures; styling and layout are the primary review focus.

* **Dashboard content**: Confirmed account value, available cash, holdings, cash/percentage profit, performance chart, rank, nearby competitors, and continuous/weekly/monthly/yearly leaderboard views. Calculation rules remain unresolved.

* **Website responsiveness**: Confirmed desktop-first design with usable mobile layouts; the complete trading view stacks vertically on phones without removing features.

* **Website order entry**: Confirmed limit orders only for the visual MVP, with price/quantity entry and cancellable resting remainders. Market orders and a separate buy/sell-now action are excluded; detailed exchange rules remain separate.

* **Trading view**: Confirmed the complete view by default, including price chart, public order book, buy/sell form, and own open orders and fills; layout and order-entry behavior remain open.

* **Website visibility**: Confirmed the public order book and no direct access to other participants' individual trades. Anonymous market-feed presentation and holdings visibility remain open.

* **Dashboard emphasis**: Confirmed equal prominence for personal financial performance and competitive standing on the website overview; layout and comparison metrics remain open.

* **Website visual MVP**: Established HTML mocks for the first design-review PR, largely mocked backend interactions, and Prague Quant Club as the visual reference. Recorded the likely later framework/component-library round; detailed scope and technology remain open.

* **Website audiences**: Established browser trading for casual participants and a competition dashboard for status, money, profit, statistics, and comparisons, including API-driven contenders. Detailed MVP scope and metrics remain open.

* **Dependency diagram**: Added a self-contained HTML planning diagram with distinct coupling, contract, and integration lines. Recorded proposed work boundaries and unresolved contract gates without changing agreed architecture.

* **Absolute imports**: Converted package imports to absolute paths and configured Ruff TID252 to reject all relative imports in both Python projects. Recorded the convention in AGENTS.md and the interface/development guides.

## 2026-11-06

* **Interface documentation**: Added concise one-line module, type, callable, health-route, and test docstrings; explicitly marked public interfaces as experimental and not finalized.

* **Export convention**: Restricted __all__ to package initializers, removed redundant callable-module exports, and recorded the convention in AGENTS.md and the public interface guide.

* **Quick verification policy**: Require Ruff lint and formatting even during fast iterations; keep tests focused and use configured CI after publication. Recorded the commands in AGENTS.md and development guidance.

* **Public type ownership**: Moved dataclasses/enums into virtual_exchange.types, with auth/trading/market_data modules depending only on the standard library. Callable interfaces import those records; existing type import paths remain available through re-exports.

* **Typed public results**: Replaced generic mapping returns with immutable dataclasses for identity, orders/fills, balances, instruments, and market observations. Core contracts stay framework independent; HTTP validation and trading behavior remain deferred.

* **Backend example and package exports**: Moved trading callable bodies to interface.py and retained initializer exports. Added an independent health-only website backend, its own lock/tests/image, and CI/Compose checks for both apps. Frontend and competition remain unimplemented.

* **Version baseline**: Audited official stable releases; updated Python, uv, GitHub Actions and package minimums, and refreshed the dependency lock. Retained exact runtime/tool versions for reproducible CI and container builds.

* **Public application boundaries**: Moved the runnable package and build under exchange/, added callable authentication/trading/market-data stubs that fail explicitly, and website backend/frontend placeholders. Competition consumes exchange data outside the exchange package; internal implementation modules remain undefined. Updated commands, CI, containers, and diagrams.

* **Runnable foundation**: Added the Python API scaffold and health route, documented package boundaries and development commands, local checks, GitHub Actions, and Docker/Compose support. Trading behavior remains unimplemented.

* **Architecture proposal**: Documented deep and orthogonal module boundaries, an exchange consistency boundary, and concrete checks for independent change. Proposal remains open for discussion.

* **Dark styling**: Restyled the HTML overview using Prague Quant Club’s near-black and indigo palette, technical labels, and fine borders. Recorded the dark-style preference; retained offline use and light print styling.

* **Overview location**: Moved the HTML overview into wiki/overview.html and updated README, wiki navigation, and its internal links.

* **Visual overview**: Reworked overview.html into a concise document with an inline module-flow diagram, brief responsibility summaries, and the initial vertical slice. Kept proposed trading rules distinct from confirmed direction.

* **Realism analysis**: Added first-slice recommendations comparing exchange behavior with relative complexity, supported by exchange documentation. Kept recommendations distinct from agreed requirements.

* **Wiki consolidation**: Absorbed the remaining project document into the existing concepts, including conceptual responsibilities, operational uncertainties, pricing bootstrap, and interface questions. Removed the duplicate docs/project.md and updated the visual overview link.

* **Documentation organization**: Trimmed the README to an introduction and navigation; kept detailed scope, priorities, market and bot behavior, and competition requirements in the existing wiki concepts. Removed source links to retired README sections.

* **Initialization**: Created the project-local OKF v0.1 wiki, authoring conventions, and agent bootstrap instructions. Imported project scope, vertical-slice priorities, exchange and bot requirements, and competition decisions from the project discussion and documentation; preserved unresolved choices.
