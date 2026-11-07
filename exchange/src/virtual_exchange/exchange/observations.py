"""Bounded post-commit delivery; socket failure never rolls back a trade."""

import asyncio
import json
from dataclasses import dataclass, field

from virtual_exchange.serialization import wire

MAX_INCOMING = 64 * 1024
MAX_OUTGOING = 1024 * 1024
MAX_PENDING_BYTES = 1024 * 1024
MAX_PENDING_MESSAGES = 256
SEND_TIMEOUT = 5.0
HEARTBEAT_SECONDS = 10.0
SUBSCRIBE_TIMEOUT = 5.0


def frames(
    *,
    process_id: str,
    channel: str,
    sequence: int,
    commit_id: int,
    kind: str,
    payload,
    max_bytes: int = MAX_OUTGOING,
) -> tuple[str, ...]:
    """Encode a bundle, fragmenting large JSON payloads without splitting state."""
    base = {
        "process_id": process_id,
        "channel": channel,
        "sequence": sequence,
        "commit_id": commit_id,
        "type": kind,
    }
    raw = json.dumps(wire(payload), separators=(",", ":"), ensure_ascii=True)
    single = json.dumps(
        {**base, "part": 1, "parts": 1, "payload": json.loads(raw)},
        separators=(",", ":"),
    )
    if len(single.encode()) <= max_bytes:
        return (single,)
    chunk_size = max_bytes // 8
    chunks = [raw[i : i + chunk_size] for i in range(0, len(raw), chunk_size)]
    result = tuple(
        json.dumps(
            {**base, "part": i + 1, "parts": len(chunks), "payload_fragment": chunk},
            separators=(",", ":"),
        )
        for i, chunk in enumerate(chunks)
    )
    if any(len(message.encode()) > max_bytes for message in result):
        raise ValueError("observation envelope exceeds message limit")
    return result


@dataclass(eq=False, slots=True)
class Subscription:
    channels: frozenset[str]
    account_id: str | None
    initial: tuple[str, ...]
    queue: asyncio.Queue[str] = field(default_factory=asyncio.Queue)
    failed: asyncio.Event = field(default_factory=asyncio.Event)
    pending_bytes: int = 0
    max_messages: int = MAX_PENDING_MESSAGES
    max_bytes: int = MAX_PENDING_BYTES

    def offer(self, messages: tuple[str, ...]) -> None:
        if self.failed.is_set():
            return
        size = sum(len(message.encode()) for message in messages)
        if (
            self.queue.qsize() + len(messages) > self.max_messages
            or self.pending_bytes + size > self.max_bytes
        ):
            self.failed.set()
            return
        self.pending_bytes += size
        for message in messages:
            self.queue.put_nowait(message)

    async def receive(self) -> str:
        message = await self.queue.get()
        self.pending_bytes -= len(message.encode())
        return message
