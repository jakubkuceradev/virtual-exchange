# Virtual Exchange

A [Prague Quant Club](https://praguequantclub.org/) project: a 24/7 online hackathon where participants trade fictional assets on a simulated exchange through a public API.

The exchange API scaffold is runnable. The website frontend and backend have
public-interface outlines; trading and website functionality are not implemented.

## Run locally

With Python 3.15.2 and [uv](https://docs.astral.sh/uv/) 0.13.7 or newer:

```sh
uv sync --project exchange --locked
uv run --project exchange --locked uvicorn virtual_exchange.api:create_app --factory
```

Check `http://127.0.0.1:8000/health`. Alternatively, run `docker compose up --build --wait`.
See [development setup](wiki/development.md) for checks, containers, and project layout.

## Documentation

- [Public interfaces](wiki/public-interfaces.md) — Exchange and website boundaries.
- [Project wiki](wiki/index.md) — Project scope, development priorities, exchange and bot requirements, and competition rules.
- [Visual module overview](wiki/overview.html) — Conceptual interactions; open in a browser without a server or external dependencies.
