"""Load operator allocations independently of credential provisioning."""

import json
from decimal import Decimal
from pathlib import Path

from virtual_exchange.types import Instrument


class TradingConfigurationError(ValueError):
    """Reject invalid configuration without including its contents."""


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def load_config(
    path: str | Path,
) -> tuple[Instrument, dict[str, tuple[Decimal, Decimal]]]:
    try:
        config = json.loads(
            Path(path).read_text(encoding="utf-8"), object_pairs_hook=_unique
        )
        if (
            not isinstance(config, dict)
            or set(config) != {"version", "instrument", "accounts"}
            or type(config["version"]) is not int
            or config["version"] != 1
        ):
            raise ValueError
        instrument = config["instrument"]
        if (
            not isinstance(instrument, dict)
            or set(instrument)
            != {
                "instrument_id",
                "base_asset",
                "quote_asset",
                "price_increment",
                "quantity_increment",
            }
            or any(not isinstance(v, str) for v in instrument.values())
        ):
            raise ValueError
        instrument = Instrument(
            **{
                **instrument,
                "price_increment": Decimal(instrument["price_increment"]),
                "quantity_increment": Decimal(instrument["quantity_increment"]),
            }
        )
        if not isinstance(config["accounts"], dict):
            raise ValueError
        allocations = {}
        for account, values in config["accounts"].items():
            if (
                not account
                or not isinstance(values, dict)
                or set(values) != {"cash", "asset"}
                or any(not isinstance(v, str) for v in values.values())
            ):
                raise ValueError
            allocations[account] = Decimal(values["cash"]), Decimal(values["asset"])
        return instrument, allocations
    except (
        OSError,
        UnicodeError,
        ValueError,
        TypeError,
        ArithmeticError,
        RecursionError,
    ):
        raise TradingConfigurationError("Invalid trading configuration") from None
