---
type: Reference
title: Development and Project Layout
---

# Development and project layout

The scaffold provides a runnable API and development checks. Trading and
competition behavior are not implemented.

## Local setup

Install Python 3.15.2 and [uv](https://docs.astral.sh/uv/getting-started/installation/) 0.13.7 or newer.
From the project root:

```sh
uv sync --locked
uv run --locked uvicorn virtual_exchange.api:create_app --factory
```

The server binds to 127.0.0.1:8000. In another terminal:

```sh
curl http://127.0.0.1:8000/health
```

Expect HTTP 200 and `{"status":"ok"}`. Health reports API liveness only.
Unknown routes, including orders and generated API docs, return 404. Ctrl+C
stops the server. No credentials, database, or private bot repository are needed.
Dependency installation needs network access; normal runtime does not.

Choose a different address or port with Uvicorn flags:

```sh
uv run --locked uvicorn virtual_exchange.api:create_app --factory --host 127.0.0.1 --port 8001
```

Keep loopback binding for local development. Uvicorn reports invalid arguments
and bind failures with nonzero exit status. No separate application configuration
or environment-file loader exists yet.

## Version baseline

Reviewed against current stable releases on 2026-11-06: Python 3.15.2,
uv 0.13.7, checkout 7.0.1, setup-uv 10.3.3, and Hatchling 1.33.0. CI and the
container pin those runtime/tool versions. Direct dependency minimums reflect
current releases; uv.lock records the resolved graph.

## Checks and packaging

```sh
uv run --locked pytest
uv run --locked ruff check .
uv run --locked ruff format --check .
uv build
```

To apply formatting, use `uv run --locked ruff format .`. Project metadata and
check configuration live in pyproject.toml; uv.lock pins resolved dependencies.
Intentional dependency changes use `uv lock` followed by the checks. The src
layout requires installing the package; do not add PYTHONPATH workarounds.
GitHub Actions runs the same checks and a separate container smoke check.

## Docker and Compose

Install Docker Engine and its Compose plugin. From the project root:

```sh
docker compose up --build --wait
curl http://127.0.0.1:8000/health
docker compose down
```

To change the host port on a POSIX shell:

```sh
PORT=8001 docker compose up --build --wait
```

Compose publishes to host loopback. The API listens on all interfaces inside
the container so published traffic can reach it. The image runs as an
unprivileged user, installs locked runtime dependencies, and has an HTTP
healthcheck. There are no volumes, credentials, or extra services. Build needs
network access to registries and package sources; runtime needs no external
service. This is local scaffolding, not production deployment configuration.

For Docker without Compose:

```sh
docker build -t virtual-exchange:local .
docker run --rm --name virtual-exchange-local -p 127.0.0.1:8000:8000 virtual-exchange:local
```

Stop that container from another terminal with `docker stop virtual-exchange-local`.

## Layout and ownership

| Location | Responsibility and status |
| --- | --- |
| src/virtual_exchange/api.py | FastAPI factory and health route; no import-time startup |
| src/virtual_exchange/exchange/ | Documented placeholder for the future exchange core |
| tests/ | HTTP checks against the actual application |
| pyproject.toml, uv.lock | Packaging, dependencies, and tool configuration |
| Dockerfile, compose.yaml | Container build and single-service local startup |
| .github/workflows/checks.yml | Python checks and container smoke verification |
| wiki/ | Project knowledge and offline visual overview |

Matching, ledger/funding, and persistence belong inside the future exchange
boundary. Market data and competition remain documentation-only responsibilities.
No fake exchange operations or private bot code are included. See
[architecture principles](/architecture-principles.md) for the broader proposal
and [development priorities](/development-priorities.md) for the trading slice.
