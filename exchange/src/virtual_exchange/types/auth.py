"""Experimental identity result records; contracts are not yet finalized."""

from dataclasses import dataclass
from enum import StrEnum


class Permission(StrEnum):
    """Name independently granted exchange capabilities."""

    READ = "read"
    TRADE = "trade"
    PUBLISH_NEWS = "publish_news"
    OBSERVE_ACCOUNTS = "observe_accounts"


@dataclass(frozen=True, slots=True)
class AuthenticatedIdentity:
    """Identify an authenticated account and its granted permissions."""

    account_id: str
    permissions: frozenset[Permission]
