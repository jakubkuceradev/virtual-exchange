"""Experimental exchange HTTP scaffold; only the health route is implemented."""

from fastapi import FastAPI


def create_app() -> FastAPI:
    """Build an isolated exchange HTTP app without starting a server."""
    app = FastAPI(
        title="Virtual Exchange",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Report process liveness without checking exchange readiness."""
        return {"status": "ok"}

    return app
