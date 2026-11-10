"""REST adapters invoke complete operations, never private financial steps."""

import re
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictStr, ValidationError

from virtual_exchange.amounts import OrderRejected
from virtual_exchange.auth import Authenticator
from virtual_exchange.exchange import Exchange
from virtual_exchange.exchange.ledger import InsufficientFunds
from virtual_exchange.exchange.service import TradingError
from virtual_exchange.http_auth import identity_dependency, permission_dependency
from virtual_exchange.serialization import wire
from virtual_exchange.types import (
    AuthenticatedIdentity,
    LimitOrder,
    OrderSide,
    Permission,
    TimeInForce,
)

# Canonical unsigned decimal strings only: no exponents, signs, separators or
# whitespace. Economic validation (increments, range) stays in the exchange.
_AMOUNT = re.compile(r"(?:0|[1-9][0-9]{0,39})(?:\.[0-9]{1,40})?", re.ASCII)


class LimitOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instrument_id: StrictStr
    side: OrderSide
    price: StrictStr
    quantity: StrictStr
    client_order_id: StrictStr | None = None
    type: Literal["limit"] = "limit"
    time_in_force: TimeInForce = TimeInForce.GTC

    def order(self) -> LimitOrder:
        if not all(_AMOUNT.fullmatch(v) for v in (self.price, self.quantity)):
            raise TradingError("invalid_order")
        return LimitOrder(
            self.instrument_id,
            self.side,
            Decimal(self.price),
            Decimal(self.quantity),
            self.client_order_id,
            self.time_in_force,
        )


def register_trading(
    app: FastAPI, *, exchange: Exchange | None, authenticator: Authenticator
) -> None:
    authenticated = identity_dependency(authenticator)
    reader = permission_dependency(identity=authenticated, permission=Permission.READ)
    trader = permission_dependency(identity=authenticated, permission=Permission.TRADE)
    observer = permission_dependency(
        identity=authenticated, permission=Permission.OBSERVE_ACCOUNTS
    )

    def service() -> Exchange:
        if exchange is None:
            raise TradingError("trading_unavailable", 503)
        return exchange

    @app.exception_handler(TradingError)
    async def trading_error(request: Request, error: TradingError):
        return JSONResponse({"error": error.code}, status_code=error.status)

    @app.exception_handler(OrderRejected)
    async def rejected(request: Request, error: OrderRejected):
        return JSONResponse({"error": "invalid_order"}, status_code=400)

    @app.exception_handler(InsufficientFunds)
    async def unfunded(request: Request, error: InsufficientFunds):
        return JSONResponse({"error": "insufficient_funds"}, status_code=409)

    @app.exception_handler(RequestValidationError)
    async def malformed(request: Request, error: RequestValidationError):
        # Default validation details can contain request values. Never echo them.
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    @app.post("/orders", status_code=201)
    async def submit(
        request: Request,
        caller: Annotated[AuthenticatedIdentity, Depends(trader)],
    ):
        ex = service()
        try:
            body = LimitOrderRequest.model_validate(await request.json())
        except ValueError, ValidationError:
            raise TradingError("invalid_request") from None
        return wire(await ex.submit_order(identity=caller, order=body.order()))

    @app.delete("/orders/{order_id}")
    async def cancel(
        order_id: str, caller: Annotated[AuthenticatedIdentity, Depends(trader)]
    ):
        return wire(await service().cancel_order(identity=caller, order_id=order_id))

    @app.get("/orders/{order_id}")
    async def get_order(
        order_id: str, caller: Annotated[AuthenticatedIdentity, Depends(reader)]
    ):
        ex = service()
        snapshot = await ex.get_order(identity=caller, order_id=order_id)
        return {"process_id": ex.process_id, "data": wire(snapshot)}

    @app.get("/orders")
    async def orders(
        caller: Annotated[AuthenticatedIdentity, Depends(reader)],
        limit: int = 100,
        cursor: str | None = None,
        status: str | None = None,
    ):
        return wire(
            await service().list_orders(
                identity=caller, limit=limit, cursor=cursor, status=status
            )
        )

    @app.get("/fills")
    async def fills(
        caller: Annotated[AuthenticatedIdentity, Depends(reader)],
        limit: int = 100,
        cursor: str | None = None,
        high_watermark: int | None = None,
    ):
        return wire(
            await service().list_fills(
                identity=caller,
                limit=limit,
                cursor=cursor,
                high_watermark=high_watermark,
            )
        )

    @app.get("/balances")
    async def balances(caller: Annotated[AuthenticatedIdentity, Depends(reader)]):
        ex = service()
        commit_id, balances = await ex.get_balance_snapshot(identity=caller)
        return {
            "process_id": ex.process_id,
            "commit_id": commit_id,
            "data": wire(balances),
        }

    @app.get("/accounts")
    async def accounts(
        response: Response,
        caller: Annotated[AuthenticatedIdentity, Depends(observer)],
    ):
        ex = service()
        commit_id, accounts = await ex.list_accounts(identity=caller)
        response.headers["Cache-Control"] = "no-store"
        return {
            "process_id": ex.process_id,
            "commit_id": commit_id,
            "data": wire(accounts),
        }

    @app.get("/account/snapshot")
    async def account(caller: Annotated[AuthenticatedIdentity, Depends(reader)]):
        snapshot = await service().get_account_snapshot(identity=caller)
        # Channel baselines are a JSON object, as in WebSocket control messages.
        return {**wire(snapshot), "channel_baselines": dict(snapshot.channel_baselines)}

    @app.get("/instruments")
    async def instruments():
        ex = service()
        return {"process_id": ex.process_id, "data": wire(await ex.list_instruments())}

    @app.get("/book")
    async def book():
        ex = service()
        snapshot = await ex.get_order_book()
        return {
            "process_id": ex.process_id,
            "commit_id": snapshot.sequence,
            "data": wire(snapshot),
        }

    @app.get("/trades")
    async def trades(limit: int = 100, cursor: str | None = None):
        return wire(await service().list_trades(limit=limit, cursor=cursor))
