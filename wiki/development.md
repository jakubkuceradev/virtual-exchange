---
type: Reference
title: Development and Project Layout
---

# Development and project layout

The exchange has health and authenticated identity endpoints; the website
backend has a health-only API. Each owns its dependencies, tests, and image.
Funded REST and WebSocket trading are implemented; competition is deferred.
The React + TypeScript + Vite / headless Mantine frontend trades live against
the exchange through a same-origin proxy, with the fixture demo kept as a mode.

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
Unknown routes and generated API docs return 404. Trading/private routes require
configured allocations and credentials; see [funded trading](/trading-slice.md). Ctrl+C
stops the server. No credentials, database, or private bot repository are needed.
Dependency installation needs network access; normal runtime does not.

Choose a different address or port with Uvicorn flags:

```sh
uv run --project exchange --locked uvicorn virtual_exchange.api:create_app --factory --host 127.0.0.1 --port 8001
```

Keep loopback binding for local development. Uvicorn reports invalid arguments
and bind failures with nonzero exit status. The exchange reads private
authentication configuration selected by EXCHANGE_AUTH_CONFIG; see [authentication](/authentication.md). No environment-file
loader is provided.

## Website frontend

Use Node 26.13.0 LTS (pinned in website/frontend/.nvmrc). From website/frontend,
run `npm ci`, then `npm run dev` (live; forwards `/exchange/*` to `EXCHANGE_URL`,
default `http://127.0.0.1:8000`) or `npm run dev:mock` (fixture demo, no backend).
Open http://127.0.0.1:5173/ and enter an exchange token on API / Account.

Two participants on separate machines can share one exchange. The operator binds
the exchange to the LAN with private configs, for example
`EXCHANGE_AUTH_CONFIG=/private/auth.json EXCHANGE_TRADING_CONFIG=/private/trading.json
uv run --project exchange --locked uvicorn virtual_exchange.api:create_app --factory
--host 0.0.0.0 --port 8000`; each participant runs
`EXCHANGE_URL=http://<operator-host>:8000 npm run dev` and opens their own
loopback URL. This is plain HTTP for a trusted local network only: no TLS or
production hosting. Two isolated browser contexts on one machine exercise the
same behavior.

`npm run check`, `npm run typecheck` and `npm test` (unit tests for decimals,
protocol, market/account reducers, session recovery and commands) run without a
browser. `npm run build:mock && npm run test:browser` runs the mock UI suite;
`npm run build && npm run test:live` starts real exchanges with synthetic
tokens behind the live preview proxy and drives two browser contexts through
trading, reconnect, and restart. CI runs both. See the
[frontend guide](../website/frontend/README.md) for ports.

## Website design preview

From the repository root, use Python's static server:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory website/frontend/design
```

Open http://127.0.0.1:4173/. Overview, Trade, Leaderboard, and API / Account
use fictional sample data and disposable local interactions; no backend is
needed. Reload resets the demo. Add `?scenario=no-trades#trade` to review empty
market/account observation states. Ctrl+C stops the server.

The [frontend README](../website/frontend/README.md) links desktop/mobile
screenshots and describes sample interactions and unresolved production policies.
With Node 26.13+ (see `.nvmrc`), run `node --test website/frontend/tests/demo.test.mjs` for the
focused demo-state tests. These do not establish real exchange integration.
The HTML mock state checks also run in frontend CI; screenshot review is manual.

## Website backend

The backend uses the same Python/FastAPI/Uvicorn tooling, with its own package
and environment. From the repository root:

```sh
uv sync --project website/backend --locked
uv run --project website/backend --locked uvicorn pqc_website.api:create_app --factory --port 8001
curl http://127.0.0.1:8001/health
```

GET /health returns HTTP 200 and `{"status":"ok"}` without connecting to the
exchange. Unknown routes and /leaderboard return 404; no competition results
are fabricated. Ctrl+C stops the backend. Its initializer contains no functions.

## Version baseline

Reviewed against current stable releases on 2026-11-06: Python 3.15.2,
uv 0.13.7, checkout 7.0.1, setup-uv 10.3.3, and Hatchling 1.33.0. CI and the
container pin those runtime/tool versions. Direct dependency minimums reflect
current releases; uv.lock records the resolved graph.

## Checks and packaging

Always run Ruff lint and formatting, including quick iterations. Ruff TID252
also rejects all relative imports in both projects. From the root,
`uv run --project exchange --locked ruff check exchange website/backend` and
`uv run --project exchange --locked ruff format exchange website/backend` cover
both apps. Use `format --check` before committing. Keep test execution focused
when iterating quickly; configured CI provides the full checks after a push.


```sh
uv run --project exchange --locked pytest exchange/tests
uv run --project exchange --locked ruff check exchange
uv run --project exchange --locked ruff format --check exchange
uv build --project exchange

uv run --project website/backend --locked pytest website/backend/tests
uv run --project website/backend --locked ruff check website/backend
uv run --project website/backend --locked ruff format --check website/backend
uv build --project website/backend
```

To apply formatting, use `uv run --project exchange --locked ruff format exchange`. Project metadata and
check configuration live in exchange/pyproject.toml; exchange/uv.lock pins resolved dependencies.
Intentional dependency changes use `uv lock --project exchange` followed by the checks. The src
layout requires installing the package; do not add PYTHONPATH workarounds.
GitHub Actions runs the same Python checks independently for exchange/ and
website/backend/, then builds and checks both containers. Each project owns its
pyproject.toml and uv.lock. Inside either project, omit --project and use pytest,
ruff check ., and ruff format --check . as usual.

## Docker and Compose

Install Docker Engine and its Compose plugin. From the project root:

```sh
docker compose up --build --wait
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8001/health
docker compose down
```

To change the host port on a POSIX shell:

```sh
PORT=18000 WEBSITE_BACKEND_PORT=18001 docker compose up --build --wait
```

Compose builds exchange/ and website/backend/, publishing both to host loopback
on ports 8000 and 8001 by default. Each API listens on all interfaces inside
its container, runs as an unprivileged user, installs locked runtime dependencies,
and has an HTTP healthcheck. The default stack has no volumes, credentials, or
databases. Optional private auth configuration uses a read-only bind mount; see [authentication](/authentication.md).
Neither health endpoint depends on the other service. Build needs
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
| exchange/src/virtual_exchange/api.py | FastAPI factory, health, and authenticated identity routes |
| exchange/src/virtual_exchange/types/ | Public dataclasses/enums; no imports from callable interfaces |
| exchange/src/virtual_exchange/auth.py | Configured token authentication and permission checks |
| exchange/src/virtual_exchange/exchange/service.py | Coordinated funded operations and consistent observations |
| exchange/src/virtual_exchange/market_data.py | Callable market-data interface stubs |
| exchange/tests/ | HTTP checks against the actual application |
| exchange/pyproject.toml, exchange/uv.lock | Independent Python packaging, dependencies, and tool configuration |
| exchange/Dockerfile, exchange/.dockerignore | Exchange image and build context |
| website/backend/src/pqc_website/api.py | Independent website API factory and health example |
| website/backend/tests/, pyproject.toml, uv.lock, Dockerfile | Backend-owned checks, dependencies, and image |
| website/frontend/src/, package.json, package-lock.json | React/headless Mantine views, independent npm dependencies and Vite build |
| website/frontend/e2e/ | Production browser interaction checks |
| website/frontend/design/, tests/, previews/ | Buildless HTML design preview, focused state checks, and desktop/mobile screenshots |
| compose.yaml, .github/workflows/ | Shared local startup and CI |
| wiki/ | Project knowledge and offline visual overview |

The exchange, website backend, and frontend build/run independently. The React
preview and HTML reference use fixtures; production service integration remains
pending.
See [public interfaces](/public-interfaces.md) for operations and dependency
boundaries. Funded operations and live delivery share one configured exchange
instance; run one Uvicorn worker because all state is in-memory.
