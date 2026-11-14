"""Validate market news drafts; the store keeps published items."""

from collections.abc import Collection
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from virtual_exchange.types import NewsDraft, NewsItem

MAX_HEADLINE = 200
MAX_BODY = 2000


class NewsRejected(ValueError):
    """Reject a draft without echoing its contents."""


def _text(value: object, *, maximum: int) -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise NewsRejected("invalid_request")
    try:
        # Lone surrogates parse from JSON but cannot be encoded back out; storing
        # one would break every later read of the feed.
        value.encode("utf-8")
    except UnicodeError:
        raise NewsRejected("invalid_request") from None
    return value


class NewsRules:
    """Own news validation; know nothing of storage, locks or transport."""

    def __init__(self, *, instrument_ids: Collection[str]) -> None:
        self._instrument_ids = frozenset(instrument_ids)

    def is_listed(self, instrument_id: object) -> bool:
        return instrument_id in self._instrument_ids

    def prepare(self, draft: NewsDraft) -> NewsItem:
        """Validate a draft and assign identity and time without storing it."""
        if not isinstance(draft, NewsDraft):
            raise NewsRejected("invalid_request")
        headline = _text(draft.headline, maximum=MAX_HEADLINE)
        if not headline.strip():
            raise NewsRejected("invalid_request")
        body = None if draft.body is None else _text(draft.body, maximum=MAX_BODY)
        ids = draft.instrument_ids
        if (
            not isinstance(ids, tuple)
            or not all(isinstance(i, str) for i in ids)
            or len(set(ids)) != len(ids)
            or not all(self.is_listed(i) for i in ids)
        ):
            raise NewsRejected("invalid_request")
        event_at = draft.event_at
        if event_at is not None:
            # Past events are accepted: the publisher's clock is not ours.
            if not isinstance(event_at, datetime) or event_at.utcoffset() != timedelta(
                0
            ):
                raise NewsRejected("invalid_request")
            event_at = event_at.replace(tzinfo=UTC)
        return NewsItem(str(uuid4()), headline, body, ids, event_at, datetime.now(UTC))
