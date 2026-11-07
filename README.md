# Virtual Exchange

A [Prague Quant Club](https://praguequantclub.org/) project: a 24/7 online hackathon where participants trade fictional assets on a simulated exchange through a public API.

The exchange and website backend have runnable health-only APIs. Trading
and competition behavior remain unimplemented. The website frontend has a
React/Vite/headless Mantine foundation and reviewed HTML mocks. Public interfaces
are experimental and not yet finalized.

## Run locally

With Python 3.15.2 and [uv](https://docs.astral.sh/uv/) 0.13.7 or newer:

```sh
uv sync --project exchange --locked
uv run --project exchange --locked uvicorn virtual_exchange.api:create_app --factory
```

Run both APIs with `docker compose up --build --wait`: exchange health is on
port 8000 and website backend health on port 8001.
See [development setup](wiki/development.md) for checks, containers, and project layout.

Run the frontend with `cd website/frontend && npm ci && npm run dev` using
Node 26.13.0 LTS. Open http://127.0.0.1:5173/. See the
[frontend guide](website/frontend/README.md) for scope, checks, and HTML mocks.

## Documentation

- [Public interfaces](wiki/public-interfaces.md) — Exchange and website boundaries.
- [Project wiki](wiki/index.md) — Project scope, development priorities, exchange and bot requirements, and competition rules.
- [Visual module overview](wiki/overview.html) — Conceptual interactions; open in a browser without a server or external dependencies.
