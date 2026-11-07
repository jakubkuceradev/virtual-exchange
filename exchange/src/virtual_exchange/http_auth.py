"""Translate bearer headers and permission failures at the HTTP boundary."""

import re
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from virtual_exchange.auth import (
    AuthenticationFailed,
    Authenticator,
    PermissionDenied,
    require_permission,
)
from virtual_exchange.types import AuthenticatedIdentity, Permission

_CHALLENGE = 'Bearer realm="exchange"'
_BEARER = re.compile(r"Bearer +([A-Za-z0-9\-._~+/]+=*)", re.IGNORECASE | re.ASCII)


def identity_dependency(
    authenticator: Authenticator,
) -> Callable[..., AuthenticatedIdentity]:
    """Bind header authentication to this application's credential snapshot."""

    def authenticated_identity(request: Request) -> AuthenticatedIdentity:
        headers = request.headers.getlist("authorization")
        challenge = _CHALLENGE
        if headers:
            challenge += ', error="invalid_token"'
            match = _BEARER.fullmatch(headers[0]) if len(headers) == 1 else None
            if match is not None:
                try:
                    return authenticator.authenticate(token=match[1])
                except AuthenticationFailed:
                    pass
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": challenge, "Cache-Control": "no-store"},
        )

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
            raise HTTPException(
                status_code=403,
                detail="Insufficient permission",
                headers={
                    "WWW-Authenticate": (
                        f'{_CHALLENGE}, error="insufficient_scope", scope="{permission.value}"'
                    ),
                    "Cache-Control": "no-store",
                },
            ) from None
        return authenticated

    return authorized_identity
