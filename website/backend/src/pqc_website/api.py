"""Website HTTP application; no exchange dependency or import-time startup."""

from fastapi import FastAPI


def create_app() -> FastAPI:
    """Create the example backend; health indicates liveness only."""
    app = FastAPI(
        title="Prague Quant Club Website",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
