"""App-owned exchange, authentication, and funded REST operations."""

import asyncio
import contextlib
import os
import signal
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, FastAPI, Response

from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.configuration import TradingConfigurationError
from virtual_exchange.http_auth import identity_dependency, register_auth_errors
from virtual_exchange.news_api import register_news
from virtual_exchange.stream_api import register_streams
from virtual_exchange.trading_api import register_trading
from virtual_exchange.types import AuthenticatedIdentity


def create_app(
    *, authenticator: Authenticator | None = None, exchange: Exchange | None = None
) -> FastAPI:
    """Build an isolated exchange HTTP app without starting a server."""
    if authenticator is None:
        authenticator = Authenticator.from_config(
            path=os.environ.get("EXCHANGE_AUTH_CONFIG")
        )
    if (
        exchange is None
        and (path := os.environ.get("EXCHANGE_TRADING_CONFIG")) is not None
    ):
        state_dir = os.environ.get("EXCHANGE_STATE_DIR")
        if not state_dir:
            raise TradingConfigurationError(
                "EXCHANGE_STATE_DIR must name the exchange store directory "
                "when EXCHANGE_TRADING_CONFIG is set"
            )
        exchange = Exchange.from_config(
            path=path, state_dir=state_dir, on_store_failure=_terminate
        )
    authenticated_identity = identity_dependency(authenticator)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if exchange is None:
            yield
            return
        retention = asyncio.create_task(exchange.run_retention())
        try:
            yield
        finally:
            retention.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await retention

    app = FastAPI(
        title="Virtual Exchange",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    register_auth_errors(app)

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Report process liveness without checking exchange readiness."""
        return {"status": "ok"}

    @app.get("/identity")
    async def identity(
        response: Response,
        caller: Annotated[AuthenticatedIdentity, Depends(authenticated_identity)],
    ) -> dict[str, object]:
        """Report only the authenticated credential's identity and grants."""
        response.headers["Cache-Control"] = "no-store"
        return {
            "account_id": caller.account_id,
            "permissions": sorted(caller.permissions),
        }

    register_trading(app, exchange=exchange, authenticator=authenticator)
    register_news(app, exchange=exchange, authenticator=authenticator)
    register_streams(app, exchange=exchange, authenticator=authenticator)
    return app


def _terminate() -> None:
    """Ask the server to shut down; the supervisor restarts it and recovery runs."""
    os.kill(os.getpid(), signal.SIGTERM)
