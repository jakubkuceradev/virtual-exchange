"""Experimental website HTTP scaffold; only the health route is implemented."""

from fastapi import FastAPI


def create_app() -> FastAPI:
    """Build an isolated website app without an exchange dependency."""
    app = FastAPI(
        title="Prague Quant Club Website",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Report backend liveness without contacting the exchange."""
        return {"status": "ok"}

    return app
