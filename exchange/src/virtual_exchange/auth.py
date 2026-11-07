"""Configured opaque-token authentication, independent of HTTP and trading."""

import hashlib
import json
import re
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType

from virtual_exchange.types import AuthenticatedIdentity, Permission


class AuthenticationFailed(ValueError):
    """Reject credentials without disclosing their contents."""


class PermissionDenied(ValueError):
    """Reject an operation outside the authenticated credential's grants."""


class AuthConfigurationError(ValueError):
    """Reject invalid private configuration without including its contents."""


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate configuration key")
        result[key] = value
    return result


class Authenticator:
    """Own an immutable credential snapshot; retain digests rather than raw tokens."""

    def __init__(
        self, *, credentials: Mapping[str, AuthenticatedIdentity] | None = None
    ) -> None:
        registry = dict(credentials) if credentials is not None else {}
        for digest, identity in registry.items():
            if (
                not isinstance(digest, str)
                or re.fullmatch(r"[0-9a-f]{64}", digest) is None
                or not isinstance(identity, AuthenticatedIdentity)
                or not isinstance(identity.account_id, str)
                or not identity.account_id
                or not isinstance(identity.permissions, frozenset)
                or any(
                    not isinstance(grant, Permission) for grant in identity.permissions
                )
            ):
                raise AuthConfigurationError("Invalid authentication configuration")
        self._credentials = MappingProxyType(registry)

    @classmethod
    def from_config(cls, *, path: str | Path | None) -> Authenticator:
        """Load one validated private JSON snapshot; no path means no credentials."""
        if path is None:
            return cls()
        try:
            document = json.loads(
                Path(path).read_text(encoding="utf-8"), object_pairs_hook=_unique_object
            )
            if (
                not isinstance(document, dict)
                or set(document) != {"version", "credentials"}
                or type(document["version"]) is not int
                or document["version"] != 1
                or not isinstance(document["credentials"], list)
            ):
                raise ValueError
            registry = {}
            for record in document["credentials"]:
                if (
                    not isinstance(record, dict)
                    or set(record) != {"token_sha256", "account_id", "permissions"}
                    or not isinstance(record["token_sha256"], str)
                    or not isinstance(record["permissions"], list)
                    or any(
                        not isinstance(grant, str) for grant in record["permissions"]
                    )
                ):
                    raise ValueError
                digest = record["token_sha256"]
                if digest in registry:
                    raise ValueError
                registry[digest] = AuthenticatedIdentity(
                    account_id=record["account_id"],
                    permissions=frozenset(
                        Permission(grant) for grant in record["permissions"]
                    ),
                )
            return cls(credentials=registry)
        except OSError, UnicodeError, ValueError, TypeError, RecursionError:
            raise AuthConfigurationError(
                "Invalid authentication configuration"
            ) from None

    def authenticate(self, *, token: str) -> AuthenticatedIdentity:
        """Resolve an exact ASCII token to identity and its independent grants."""
        if not isinstance(token, str) or not token:
            raise AuthenticationFailed("Authentication required")
        try:
            digest = hashlib.sha256(token.encode("ascii")).hexdigest()
        except UnicodeError:
            raise AuthenticationFailed("Authentication required") from None
        identity = self._credentials.get(digest)
        if identity is None:
            raise AuthenticationFailed("Authentication required")
        return identity


def require_permission(
    *, identity: AuthenticatedIdentity, permission: Permission
) -> None:
    """Enforce one explicit grant; trade never implicitly grants read access."""
    if permission not in identity.permissions:
        raise PermissionDenied("Insufficient permission")
