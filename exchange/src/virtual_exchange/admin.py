"""Operator commands for the exchange store.

Run ``python -m virtual_exchange.admin init-store`` once to create an empty
store in EXCHANGE_STATE_DIR (or ``--state-dir``). The exchange never creates a
store itself, so a missing volume fails startup instead of starting afresh.
"""

import argparse
import os
import sys

from virtual_exchange.exchange.store import Store, StoreError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m virtual_exchange.admin")
    parser.add_argument(
        "--state-dir",
        default=os.environ.get("EXCHANGE_STATE_DIR"),
        help="store directory (default: EXCHANGE_STATE_DIR)",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init-store", help="create an empty exchange store")
    arguments = parser.parse_args(argv)
    if not arguments.state_dir:
        parser.error("set EXCHANGE_STATE_DIR or pass --state-dir")
    try:
        path = Store.create(arguments.state_dir)
    except StoreError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"Created an empty exchange store at {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
