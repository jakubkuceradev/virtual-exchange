"""Website HTTP API: health and competition rankings from exchange facts."""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Annotated

import httpx2
from fastapi import FastAPI, Header, Response
from fastapi.responses import JSONResponse

from pqc_website import periods
from pqc_website.competition import Competition, Snapshot, Standings
from pqc_website.exchange_client import (
    ExchangeClient,
    ExchangeUnavailable,
    IdentityRejected,
)
from pqc_website.periods import Period
from pqc_website.store import Store

_log = logging.getLogger(__name__)

SAMPLE_INTERVAL = 10.0  # seconds between exchange samples
STALE_AFTER = timedelta(seconds=120)
_VALUE = Decimal("0.00000001")
_PERCENT = Decimal("0.000001")


class ConfigurationError(RuntimeError):
    """The competition configuration is incomplete or unreadable."""


class _Error(Exception):
    def __init__(self, code: str, status: int, headers: dict | None = None) -> None:
        super().__init__(code)
        self.code, self.status, self.headers = code, status, headers


def _time(moment: datetime | None) -> str | None:
    return None if moment is None else moment.astimezone(UTC).isoformat()


def _percent(ret: Decimal | None) -> str | None:
    return None if ret is None else format((ret * 100).quantize(_PERCENT), "f")


def _value(amount: Decimal | None) -> str | None:
    return None if amount is None else format(amount.quantize(_VALUE), "f")


def _rows(rows) -> list[dict]:
    return [
        {"rank": position, "account_id": account, "return_percent": _percent(ret)}
        for position, account, ret in rows
    ]


def _period(standings: Standings) -> dict:
    return {
        "start": _time(standings.start),
        "end": _time(standings.end),
        "participant_count": len(standings.rows),
    }


async def sample(competition: Competition, client: ExchangeClient) -> None:
    """Take one exchange sample and feed it to the competition."""
    accounts = await client.accounts()
    price = await client.price()
    competition.observe(datetime.now(UTC), accounts, price)


async def run_sampler(
    competition: Competition, client: ExchangeClient, interval: float
) -> None:
    """Sample forever; failures are logged and the next tick retries."""
    while True:
        started = time.monotonic()
        try:
            await sample(competition, client)
        except ExchangeUnavailable as error:
            _log.warning("exchange sample failed: %s", error)
        except Exception:
            _log.exception("competition tick failed; state kept from the last tick")
        await asyncio.sleep(max(0.0, interval - (time.monotonic() - started)))


def from_environment() -> tuple[Competition, httpx2.AsyncClient, str] | None:
    """Configure competition from WEBSITE_* variables; None when disabled."""
    state_dir = os.environ.get("WEBSITE_STATE_DIR")
    if not state_dir:
        return None
    token_file = os.environ.get("WEBSITE_EXCHANGE_TOKEN_FILE")
    if not token_file:
        raise ConfigurationError(
            "WEBSITE_EXCHANGE_TOKEN_FILE must name the observer token file"
        )
    try:
        token = Path(token_file).read_text(encoding="ascii").strip()
    except (OSError, UnicodeError) as error:
        raise ConfigurationError(
            f"Cannot read the observer token file: {error}"
        ) from None
    if not token:
        raise ConfigurationError("The observer token file is empty")
    url = os.environ.get("WEBSITE_EXCHANGE_URL", "http://127.0.0.1:8000")
    competition = Competition(Store.open(state_dir))
    return competition, httpx2.AsyncClient(base_url=url, timeout=5.0), token


def create_app(
    *,
    competition: Competition | None = None,
    exchange: ExchangeClient | None = None,
    sample_interval: float | None = SAMPLE_INTERVAL,
) -> FastAPI:
    """Build the website app.

    With no arguments, competition is configured from the environment and
    disabled (503) when WEBSITE_STATE_DIR is unset. Tests inject a competition
    and an exchange client; sample_interval=None runs no sampler.
    """
    http = None
    if competition is None and exchange is None:
        configured = from_environment()
        if configured is not None:
            competition, http, token = configured
            exchange = ExchangeClient(http, token)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        if competition is not None and exchange is not None and sample_interval:
            task = asyncio.create_task(
                run_sampler(competition, exchange, sample_interval)
            )
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            if http is not None:
                await http.aclose()
                competition.store.close()

    app = FastAPI(
        title="Prague Quant Club Website",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.exception_handler(_Error)
    async def error(request, error: _Error):
        return JSONResponse(
            {"error": error.code}, status_code=error.status, headers=error.headers
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Report backend liveness without contacting the exchange."""
        return {"status": "ok"}

    def ready() -> Competition:
        if competition is None:
            raise _Error("competition_unavailable", 503)
        return competition

    def current() -> Snapshot:
        snapshot = ready().snapshot
        if (
            snapshot is None
            or snapshot.mark is None
            or datetime.now(UTC) - snapshot.computed_at > STALE_AFTER
        ):
            raise _Error("rankings_unavailable", 503)
        return snapshot

    def kind(value: str) -> Period:
        try:
            return Period(value)
        except ValueError:
            raise _Error("unknown_period", 404) from None

    async def caller(authorization: str | None) -> str:
        if exchange is None:
            raise _Error("competition_unavailable", 503)
        if not authorization:
            raise _Error(
                "authentication_required",
                401,
                {"WWW-Authenticate": 'Bearer realm="website"'},
            )
        try:
            return await exchange.identity(authorization)
        except IdentityRejected as rejected:
            raise _Error(
                rejected.body.get("error", "invalid_token"), rejected.status
            ) from None
        except ExchangeUnavailable:
            raise _Error("exchange_unavailable", 503) from None

    @app.get("/competition/leaderboard")
    async def leaderboard(response: Response) -> dict:
        """Public standings per period: rank, account ID and return only."""
        snapshot = current()
        response.headers["Cache-Control"] = "no-store"
        return {
            "computed_at": _time(snapshot.computed_at),
            "periods": {
                standings.period.value: {
                    **_period(standings),
                    "rows": _rows(standings.rows),
                }
                for standings in snapshot.standings.values()
            },
        }

    @app.get("/competition/standings")
    async def standings_list(period: str) -> dict:
        """Finished periods with frozen final standings, newest first."""
        frozen = ready().store.frozen_list(kind(period))
        return {
            "data": [
                {
                    "period": item.period,
                    "start": _time(item.start),
                    "end": _time(item.end),
                    "local_start": periods.local_date(item.start).isoformat(),
                    "frozen_at": _time(item.frozen_at),
                    "participant_count": len(item.rows),
                }
                for item in frozen
            ]
        }

    @app.get("/competition/standings/{period}/{local_start}")
    async def standings(period: str, local_start: str) -> dict:
        """One finished period's frozen standings, named by its local start date."""
        selected = kind(period)
        if selected == Period.CONTINUOUS:
            raise _Error("unknown_period", 404)
        try:
            day = date.fromisoformat(local_start)
        except ValueError:
            raise _Error("unknown_standings", 404) from None
        start = periods.start(
            selected, datetime.combine(day, datetime.min.time(), periods.ZONE)
        )
        item = ready().store.frozen(selected, start)
        if item is None or periods.local_date(start) != day:
            raise _Error("unknown_standings", 404)
        return {
            "period": item.period,
            "start": _time(item.start),
            "end": _time(item.end),
            "frozen_at": _time(item.frozen_at),
            "participant_count": len(item.rows),
            "rows": _rows(item.rows),
        }

    @app.get("/competition/me")
    async def me(
        response: Response, authorization: Annotated[str | None, Header()] = None
    ) -> dict:
        """The caller's value, return, rank and neighbourhood per period."""
        account = await caller(authorization)
        snapshot = current()
        if account not in snapshot.values:
            raise _Error("account_not_found", 404)
        response.headers["Cache-Control"] = "no-store"
        value = snapshot.values[account]
        result = {}
        for standings in snapshot.standings.values():
            position = standings.positions[account]
            nearby = []
            if position.rank is not None:
                index = next(
                    i for i, row in enumerate(standings.rows) if row[1] == account
                )
                nearby = _rows(standings.rows[max(0, index - 2) : index + 3])
            result[standings.period.value] = {
                **_period(standings),
                "return_percent": _percent(position.ret),
                "baseline_value": _value(position.baseline),
                "rank": position.rank,
                "unranked_reason": position.reason,
                "neighbourhood": nearby,
            }
        return {
            "account_id": account,
            "computed_at": _time(snapshot.computed_at),
            "funding": "funded" if snapshot.funded[account] else "unlimited",
            "value": _value(value),
            "periods": result,
        }

    @app.get("/competition/me/series")
    async def me_series(
        response: Response, authorization: Annotated[str | None, Header()] = None
    ) -> dict:
        """The caller's value every 10 minutes over at most one year."""
        account = await caller(authorization)
        points = ready().series(account)
        response.headers["Cache-Control"] = "no-store"
        return {
            "account_id": account,
            "interval_seconds": 600,
            "points": [
                {"at": _time(at), "value": _value(value)} for at, value in points
            ],
        }

    return app
