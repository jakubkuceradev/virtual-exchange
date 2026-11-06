# Project knowledge

Before substantive work, read [wiki/index.md](wiki/index.md), then
[wiki/conventions.md](wiki/conventions.md) and the concepts relevant to the task.
Use the wiki when answering project questions. Verify current implementation
claims against repository state.

Maintain the wiki when durable decisions, expectations, or implementation facts
change. Follow its authoring conventions, update the nearest index, and record
material changes in wiki/log.md. Keep unresolved choices explicit.

# Quick verification

Always run Ruff lint and formatting for code changes, including quick iterations.
From the repository root:

```sh
uv run --project exchange --locked ruff check exchange website/backend
uv run --project exchange --locked ruff format exchange website/backend
uv run --project exchange --locked ruff format --check exchange website/backend
```

Keep follow-up checks focused; do not rerun full suites or wait on CI during quick
iteration unless requested or required by the change.

# Python package conventions

Use only absolute imports. Relative imports are prohibited; Ruff TID252 enforces
this rule in both Python projects.

Define `__all__` only in `__init__.py`. Keep initializers to documentation,
imports/exports, and metadata. Other modules import the types their code needs;
canonical public records live in `virtual_exchange.types`.
