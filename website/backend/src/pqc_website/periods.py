"""Competition periods: continuous and Europe/Prague calendar week, month, year."""

from datetime import UTC, date, datetime, time, timedelta
from enum import StrEnum
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("Europe/Prague")


class Period(StrEnum):
    CONTINUOUS = "continuous"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


CALENDAR = (Period.WEEKLY, Period.MONTHLY, Period.YEARLY)


def _midnight(day: date) -> datetime:
    # Prague changes clocks at 02:00/03:00, so local midnight always exists.
    return datetime.combine(day, time(0), ZONE).astimezone(UTC)


def start(period: Period, at: datetime) -> datetime | None:
    """Return the UTC start of the calendar period containing `at`.

    Continuous has no common start; each account starts at its creation.
    """
    local = at.astimezone(ZONE).date()
    match period:
        case Period.CONTINUOUS:
            return None
        case Period.WEEKLY:
            return _midnight(local - timedelta(days=local.weekday()))
        case Period.MONTHLY:
            return _midnight(local.replace(day=1))
        case Period.YEARLY:
            return _midnight(local.replace(month=1, day=1))


def end(period: Period, begin: datetime | None) -> datetime | None:
    """Return the UTC end (the next period's start) of the period at `begin`."""
    if begin is None:
        return None
    local = begin.astimezone(ZONE).date()
    match period:
        case Period.WEEKLY:
            return _midnight(local + timedelta(days=7))
        case Period.MONTHLY:
            month = local.month % 12 + 1
            return _midnight(local.replace(year=local.year + (month == 1), month=month))
        case Period.YEARLY:
            return _midnight(local.replace(year=local.year + 1))
    raise ValueError(f"{period} has no end")


def local_date(moment: datetime) -> date:
    """Name a period by the local date it starts on."""
    return moment.astimezone(ZONE).date()
