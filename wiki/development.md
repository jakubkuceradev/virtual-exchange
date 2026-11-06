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
uv sync --project exchange --locked
uv run --project exchange --locked uvicorn virtual_exchange.api:create_app --factory
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
uv run --project exchange --locked uvicorn virtual_exchange.api:create_app --factory --host 127.0.0.1 --port 8001
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
uv run --project exchange --locked pytest exchange/tests
uv run --project exchange --locked ruff check exchange
uv run --project exchange --locked ruff format --check exchange
uv build --project exchange
```

To apply formatting, use `uv run --project exchange --locked ruff format exchange`. Project metadata and
check configuration live in exchange/pyproject.toml; exchange/uv.lock pins resolved dependencies.
Intentional dependency changes use `uv lock --project exchange` followed by the checks. The src
layout requires installing the package; do not add PYTHONPATH workarounds.
GitHub Actions runs the same Python checks from exchange/ and a separate
container smoke check from the repository root. Inside exchange/, omit the
--project option and use pytest, ruff check ., and ruff format --check . as usual.

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

Compose builds from exchange/ and publishes to host loopback. The API listens on all interfaces inside
the container so published traffic can reach it. The image runs as an
unprivileged user, installs locked runtime dependencies, and has an HTTP
healthcheck. There are no volumes, credentials, or extra services. Build needs
network access to registries and package sources; runtime needs no external
service. This is local scaffolding, not production deployment configuration.

For Docker without Compose:

```sh
docker build -t virtual-exchange:local ./exchange
docker run --rm --name virtual-exchange-local -p 127.0.0.1:8000:8000 virtual-exchange:local
```

Stop that container from another terminal with `docker stop virtual-exchange-local`.

## Layout and ownership

| Location | Responsibility and status |
| --- | --- |
| exchange/src/virtual_exchange/api.py | FastAPI factory and health route |
| exchange/src/virtual_exchange/auth.py | Callable authentication interface stubs |
| exchange/src/virtual_exchange/exchange/ | Callable trading interface stubs |
| exchange/src/virtual_exchange/market_data.py | Callable market-data interface stubs |
| exchange/tests/ | HTTP checks against the actual application |
| exchange/pyproject.toml, exchange/uv.lock | Independent Python packaging, dependencies, and tool configuration |
| exchange/Dockerfile, exchange/.dockerignore | Exchange image and build context |
| website/backend/, website/frontend/ | Public responsibility outlines; no stack or runtime yet |
| compose.yaml, .github/workflows/ | Shared local startup and CI |
| wiki/ | Project knowledge and offline visual overview |

Only the exchange is runnable. Website dependencies, tests, and image definitions
will be added within its backend/frontend folders when their stacks are chosen.
See [public interfaces](/public-interfaces.md) for operations and dependency
boundaries. Internal exchange modules remain unspecified.
