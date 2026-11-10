"""REST adapters for market news; the exchange owns news rules and ordering."""

import re
from datetime import datetime
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel, ConfigDict, StrictStr, ValidationError

from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.service import TradingError
from virtual_exchange.http_auth import identity_dependency, permission_dependency
from virtual_exchange.serialization import wire
from virtual_exchange.types import AuthenticatedIdentity, NewsDraft, Permission

# RFC 3339 with an explicit UTC designator; fromisoformat alone accepts dates,
# basic formats and naive times.
_UTC_TIME = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?"
    r"(?:Z|\+00:00)",
    re.ASCII,
)


class NewsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    headline: StrictStr
    body: StrictStr | None = None
    instrument_ids: list[StrictStr] = []
    event_at: StrictStr | None = None

    def draft(self) -> NewsDraft:
        event_at = None
        if self.event_at is not None:
            if _UTC_TIME.fullmatch(self.event_at) is None:
                raise TradingError("invalid_request")
            try:
                event_at = datetime.fromisoformat(self.event_at)
            except ValueError:
                raise TradingError("invalid_request") from None
        return NewsDraft(self.headline, self.body, tuple(self.instrument_ids), event_at)


def register_news(
    app: FastAPI, *, exchange: Exchange | None, authenticator: Authenticator
) -> None:
    """Add news routes; TradingError responses come from register_trading."""
    publisher = permission_dependency(
        identity=identity_dependency(authenticator),
        permission=Permission.PUBLISH_NEWS,
    )

    def service() -> Exchange:
        if exchange is None:
            raise TradingError("trading_unavailable", 503)
        return exchange

    @app.post("/news", status_code=201)
    async def publish(
        request: Request,
        caller: Annotated[AuthenticatedIdentity, Depends(publisher)],
    ):
        ex = service()
        try:
            body = NewsRequest.model_validate(await request.json())
        except ValueError, ValidationError:
            raise TradingError("invalid_request") from None
        item = await ex.publish_news(identity=caller, draft=body.draft())
        return {"process_id": ex.process_id, "data": wire(item)}

    @app.get("/news")
    async def news(
        limit: int = 100,
        cursor: str | None = None,
        high_watermark: int | None = None,
        instrument_id: str | None = None,
    ):
        return wire(
            await service().list_news(
                limit=limit,
                cursor=cursor,
                high_watermark=high_watermark,
                instrument_id=instrument_id,
            )
        )
