# Wiki Update Log

## 2026-11-06

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
