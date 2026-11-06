"""Experimental authentication interface; unimplemented and not yet finalized."""

from collections.abc import Mapping

from virtual_exchange.types.auth import (
    AuthenticatedIdentity,
)


def authenticate(*, credentials: Mapping[str, str]) -> AuthenticatedIdentity:
    """Authenticate credentials into identity and permissions; not implemented."""
    raise NotImplementedError("authenticate is not implemented")
