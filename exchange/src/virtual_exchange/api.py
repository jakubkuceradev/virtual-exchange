"""HTTP application construction; importing this module starts no services."""

from fastapi import FastAPI


def create_app() -> FastAPI:
    """Create the API. Health reports liveness, not exchange readiness."""
    app = FastAPI(
        title="Virtual Exchange",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
