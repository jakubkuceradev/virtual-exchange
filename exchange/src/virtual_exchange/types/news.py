"""Experimental market news records; contracts are not yet finalized."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class NewsDraft:
    """Describe an item a publisher asks the exchange to store and distribute."""

    headline: str
    body: str | None = None
    instrument_ids: tuple[str, ...] = ()
    event_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class NewsItem:
    """An immutable published item with exchange-assigned identity and time."""

    news_id: str
    headline: str
    body: str | None
    instrument_ids: tuple[str, ...]
    event_at: datetime | None
    published_at: datetime
