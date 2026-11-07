"""Translate bearer headers and permission failures at the HTTP boundary."""

import re
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from virtual_exchange.auth import (
    AuthenticationFailed,
    Authenticator,
    PermissionDenied,
    require_permission,
)
from virtual_exchange.types import AuthenticatedIdentity, Permission

_CHALLENGE = 'Bearer realm="exchange"'
_BEARER = re.compile(r"Bearer +([A-Za-z0-9\-._~+/]+=*)", re.IGNORECASE | re.ASCII)


class BearerError(Exception):
    """Carry a stable error code and challenge without request values."""

    def __init__(self, *, status: int, code: str, challenge: str) -> None:
        self.status = status
        self.code = code
        self.challenge = challenge


def register_auth_errors(app: FastAPI) -> None:
    """Report bearer failures with the same {"error": code} body as other errors."""

    @app.exception_handler(BearerError)
    async def bearer_error(request: Request, error: BearerError) -> JSONResponse:
        return JSONResponse(
            {"error": error.code},
            status_code=error.status,
            headers={"WWW-Authenticate": error.challenge, "Cache-Control": "no-store"},
        )


def identity_dependency(
    authenticator: Authenticator,
) -> Callable[..., AuthenticatedIdentity]:
    """Bind header authentication to this application's credential snapshot."""

    def authenticated_identity(request: Request) -> AuthenticatedIdentity:
        headers = request.headers.getlist("authorization")
        challenge, code = _CHALLENGE, "authentication_required"
        if headers:
            challenge, code = f'{_CHALLENGE}, error="invalid_token"', "invalid_token"
            match = _BEARER.fullmatch(headers[0]) if len(headers) == 1 else None
            if match is not None:
                try:
                    return authenticator.authenticate(token=match[1])
                except AuthenticationFailed:
                    pass
        raise BearerError(status=401, code=code, challenge=challenge)

    return authenticated_identity


def permission_dependency(
    *, identity: Callable[..., AuthenticatedIdentity], permission: Permission
) -> Callable[..., AuthenticatedIdentity]:
    """Require a grant after authentication and return the trusted identity."""

    def authorized_identity(
        authenticated: Annotated[AuthenticatedIdentity, Depends(identity)],
    ) -> AuthenticatedIdentity:
        try:
            require_permission(identity=authenticated, permission=permission)
        except PermissionDenied:
            raise BearerError(
                status=403,
                code="insufficient_scope",
                challenge=(
                    f'{_CHALLENGE}, error="insufficient_scope", scope="{permission.value}"'
                ),
            ) from None
        return authenticated

    return authorized_identity
