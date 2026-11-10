"""Operator commands for the exchange store in EXCHANGE_STATE_DIR.

- ``init-store`` creates an empty store. The exchange never creates one itself,
  so a missing volume fails startup instead of starting afresh.
- ``backup-store DEST`` copies one committed state while trading runs.
- ``restore-store SOURCE`` replaces the store with a backup; the exchange must
  be stopped.
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
    backup = commands.add_parser("backup-store", help="copy the store while running")
    backup.add_argument("destination", help="new file to write; must not exist")
    restore = commands.add_parser(
        "restore-store", help="replace the store with a backup (exchange stopped)"
    )
    restore.add_argument("source", help="a file written by backup-store")
    arguments = parser.parse_args(argv)
    if not arguments.state_dir:
        parser.error("set EXCHANGE_STATE_DIR or pass --state-dir")
    try:
        if arguments.command == "init-store":
            path = Store.create(arguments.state_dir)
            print(f"Created an empty exchange store at {path}")
        elif arguments.command == "backup-store":
            Store.backup(arguments.state_dir, arguments.destination)
            print(f"Backed up the exchange store to {arguments.destination}")
        else:
            Store.restore(arguments.state_dir, arguments.source)
            print(f"Restored the exchange store from {arguments.source}")
    except StoreError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
