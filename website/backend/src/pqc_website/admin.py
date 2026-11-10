"""Operator commands for the website store: `init-store` and `backup-store`."""

import argparse
import os
import sys

from pqc_website.store import Store, StoreError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pqc_website.admin")
    parser.add_argument(
        "--state-dir",
        default=os.environ.get("WEBSITE_STATE_DIR"),
        help="store directory (default: WEBSITE_STATE_DIR)",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init-store", help="create an empty store")
    backup = commands.add_parser(
        "backup-store", help="copy a consistent store while the backend runs"
    )
    backup.add_argument("destination")
    arguments = parser.parse_args(argv)
    if not arguments.state_dir:
        parser.error("set WEBSITE_STATE_DIR or pass --state-dir")
    try:
        if arguments.command == "init-store":
            print(f"Created {Store.create(arguments.state_dir)}")
        else:
            Store.backup(arguments.state_dir, arguments.destination)
            print(f"Backed up to {arguments.destination}")
    except StoreError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
