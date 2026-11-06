# Website backend

Independent FastAPI example. Only `GET /health` is implemented; competition,
valuation, and rankings remain planned. It starts without the exchange.

From the repository root:

```sh
uv sync --project website/backend --locked
uv run --project website/backend --locked uvicorn pqc_website.api:create_app --factory --port 8001
```

See [development setup](../../wiki/development.md) and
[public interfaces](../../wiki/public-interfaces.md) for checks and boundaries.
