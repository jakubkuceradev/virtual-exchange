"""Check a running website deployment end to end through its public entry point.

Usage (from the repository root):

    uv run --project exchange --locked python deploy/smoke_test.py http://127.0.0.1:8080
    SMOKE_TOKEN=... uv run --project exchange --locked python deploy/smoke_test.py \
        https://quant.jakubkuceradev.cz

The token is read from SMOKE_TOKEN (never from arguments) and never printed.
Without SMOKE_TOKEN the synthetic example token is used, which only works with
deploy/examples/auth.json. Requires a token with the read grant.
"""

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request

import websockets

SYNTHETIC_TOKEN = "synthetic-alice-token-not-secret"


def http_get(url: str, token: str | None = None) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "deploy-smoke"})
    if token is not None:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def check(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL {message}", file=sys.stderr)
        raise SystemExit(1)
    print(f"ok   {message}")


def check_http(base: str, token: str) -> None:
    status, body = http_get(f"{base}/")
    check(status == 200 and b'id="root"' in body, "website serves the app shell")
    status, body = http_get(f"{base}/exchange/health")
    check(
        status == 200 and json.loads(body) == {"status": "ok"},
        "/exchange/health reaches the exchange",
    )
    status, _ = http_get(f"{base}/exchange/identity")
    check(status == 401, "/exchange/identity without a token is rejected")
    status, body = http_get(f"{base}/exchange/identity", token)
    identity = json.loads(body) if status == 200 else {}
    check(
        status == 200 and "read" in identity.get("permissions", []),
        "authenticated /exchange/identity succeeds with read grant",
    )


async def check_stream(base: str, token: str, heartbeats: int) -> None:
    url = "ws" + base.removeprefix("http") + "/exchange/ws"
    started = time.monotonic()
    async with websockets.connect(url, open_timeout=10) as socket:
        await socket.send(
            json.dumps(
                {
                    "type": "subscribe",
                    "channels": ["book", "trades", "orders", "fills"],
                    "token": token,
                }
            )
        )
        kinds: list[str] = []
        seen = 0
        while seen < heartbeats:
            message = json.loads(await asyncio.wait_for(socket.recv(), timeout=30))
            kinds.append(message["type"])
            seen += message["type"] == "heartbeat"
        elapsed = time.monotonic() - started
    check("subscribed" in kinds, "WebSocket subscription is accepted")
    check(
        "snapshot_start" in kinds and "snapshot_end" in kinds,
        "WebSocket delivers the book snapshot",
    )
    check(True, f"WebSocket stayed open for {heartbeats} heartbeats ({elapsed:.0f} s)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("base_url", help="website origin, e.g. http://127.0.0.1:8080")
    parser.add_argument("--heartbeats", type=int, default=2)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    token = os.environ.get("SMOKE_TOKEN") or SYNTHETIC_TOKEN
    check_http(base, token)
    asyncio.run(check_stream(base, token, args.heartbeats))


if __name__ == "__main__":
    main()
