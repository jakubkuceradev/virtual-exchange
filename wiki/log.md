# Wiki Update Log

## 2026-11-07

* **Frontend integration status**: Marked every React source module/component with mocked backend/frontend responsibilities and implemented UI behavior; added a component replacement map to distinguish visual completeness from real API integration. Navbar rendering was compared with the HTML reference; the user confirmed it can stay unchanged.

* **React website preview**: Migrated the four approved views into React with headless Mantine controls, CSS Modules, accessible SVG charts, hash navigation, and typed local order/credential state. Preserved the HTML reference, added shared state regressions and desktop/mobile browser checks/screenshots, and retained fixture-only service boundaries.

* **Frontend foundation**: Added a separately buildable React/TypeScript/Vite app with headless Mantine, CSS Modules, local fonts, fixture account tabs, locked current stable dependencies, and frontend CI/browser checks. Full view migration and backend integration remain pending.

* **Approved website mock**: Added the final responsive Overview, Trade, Leaderboard, and API / Account HTML design with QC/EUR fixtures, local trading/credential interactions, state tests, and desktop/mobile screenshots. Uses square corners, subtle shared panels, locally licensed club fonts, and club/social footer links. Only the final mock is included; React/TypeScript/Vite with headless Mantine is the agreed next implementation stack. Production services remain health-only.

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
