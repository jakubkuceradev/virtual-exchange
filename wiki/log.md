# Wiki Update Log

## 2026-11-10

* **Market news (exchange)**: Added the operator-granted `publish_news` permission, `POST /news`, public newest-first `GET /news` with the standard cursor/high-watermark paging, and the public `news` WebSocket channel whose sequence equals the item count for exact recovery. News is in memory, creates no trading commit, accepts past `event_at`, and rejects whitespace-only headlines.

* **Exchange bot support**: Added IOC time in force, the maker side on public trades, and operator-configured unlimited-funding accounts whose cash and asset may go negative. Decided bot exclusion from rankings: the website ranks only `funded` accounts using the exchange-published funding policy, with every operator bot configured `unlimited`; publication comes with the ranking data slice. The bot-funding tradeoff is decided.

## 2026-11-07

* **Client-actionable wire fixes**: Bearer failures now return `{"error": code}` like other exchange errors; `/account/snapshot` channel baselines are an object, matching WebSocket control messages; refused subscriptions close 4401/4403 with the error code as reason instead of the protocol-error 1008.

* **Stream review fixes**: Subscriber limits now bound backlog rather than single bundles, so multi-part bundles over 1 MiB reach caught-up subscribers instead of forcing reconnects; heartbeats are queued behind earlier updates.

* **REST review fixes**: Required canonical unsigned decimal amount strings, emitted plain decimal notation, added commit IDs to /book and /balances, and served /balances without copying order history.

* **Funded exchange review fixes**: Bounded decimal digits/scale before exact arithmetic; made command cost independent of retained history through overlay candidates and paged history queries; added maker/taker `liquidity` to fills; book snapshots report their commit. History will move to storage with persistence instead of staying in memory.

* **Matching result reason removed**: Dropped the unused `MatchingResult.cancellation_reason`; snapshot prevented/cancelled quantities already record why quantity was removed, for makers as well as incoming orders.

* **Trading observations**: Added authenticated private/public WebSocket channels with settled post-commit bundles, gap-free snapshots, channel sequences, bounded queues, reconnect guidance, and cancellation-safe cleanup. Verified real Uvicorn HTTP/WebSocket trading and restart with synthetic credentials.

* **Trading REST**: Connected configured funded exchange instances to submit/cancel, private account/recovery queries, and public book/trade observations. Added acceptance receipts, sanitized errors, and cursor/client-ID reconciliation.

* **Funded exchange operations**: Added app-owned coordinated funding, exact settlement, candidate commit isolation, private queries, operator allocations, and account-scoped client-ID reconciliation. Network adapters follow in stacked changes.

* **Matching alignment**: Adopted decrement-and-cancel with explicit prevented/remaining/cancelled quantities, terminal-cancellation errors, and generated exchange IDs separate from optional client metadata. Updated acceptance examples and retained earlier executions and maker priority.

* **Authentication**: Added app-owned bearer authentication, hashed private configuration, independent read/trade permissions, and GET /identity. Documented restart-based credential changes and container configuration; trading and funding remain separate.

* **Matching core**: Implemented the agreed sequential in-memory limit book, exact tick/lot arithmetic, immutable matching outcomes, cancellation, and cancel-newest self-trade prevention. Documented the internal contract and acceptance tests; account integration and participant trading remain deferred.

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
