# Website backend

Independent FastAPI app: `GET /health` and the competition service (valuation,
baselines and rankings from the exchange's published API). It starts without
the exchange; competition routes need `WEBSITE_STATE_DIR` and an observer token,
described in [development setup](../../wiki/development.md#competition-service).

From the repository root:

```sh
uv sync --project website/backend --locked
uv run --project website/backend --locked uvicorn pqc_website.api:create_app --factory --port 8001
```

See [development setup](../../wiki/development.md) and
[public interfaces](../../wiki/public-interfaces.md) for checks and boundaries.
