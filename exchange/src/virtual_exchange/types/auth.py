"""Experimental identity result records; contracts are not yet finalized."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AuthenticatedIdentity:
    """Identify an authenticated account and its granted permissions."""

    account_id: str
    permissions: frozenset[str]
