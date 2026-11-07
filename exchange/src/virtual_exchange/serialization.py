"""Encode immutable observations without exposing internal state containers."""

from dataclasses import fields, is_dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum


def wire(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {field.name: wire(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, dict):
        return {key: wire(item) for key, item in value.items()}
    if isinstance(value, (tuple, list, frozenset)):
        return [wire(item) for item in value]
    return value
