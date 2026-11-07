"""WebSocket observations share the authoritative funded exchange instance."""

import asyncio
import json

import anyio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from virtual_exchange.auth import AuthenticationFailed, Authenticator, PermissionDenied
from virtual_exchange.exchange import Exchange, observations
from virtual_exchange.exchange.service import TradingError


class StreamClosed(Exception):
    def __init__(self, code: int) -> None:
        self.code = code


async def message(socket: WebSocket) -> dict:
    packet = await socket.receive()
    if packet["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(packet.get("code", 1000))
    text = packet.get("text")
    if text is None:
        if len(packet.get("bytes", b"")) > observations.MAX_INCOMING:
            raise StreamClosed(1009)
        raise StreamClosed(1008)
    if len(text.encode()) > observations.MAX_INCOMING:
        raise StreamClosed(1009)
    try:
        value = json.loads(text)
    except ValueError, RecursionError:
        raise StreamClosed(1008) from None
    if not isinstance(value, dict):
        raise StreamClosed(1008)
    return value


def rejection(error: Exception) -> tuple[int, str | None]:
    """Map a refused subscription to a close code clients can act on.

    4401/4403 mirror HTTP 401/403 so clients can stop reconnecting on credential
    or grant failures; the reason is a stable code that never carries request values.
    """
    if isinstance(error, AuthenticationFailed):
        return 4401, "invalid_token"
    if isinstance(error, PermissionDenied):
        return 4403, "insufficient_scope"
    if isinstance(error, TradingError) and error.status in {401, 403}:
        return 4000 + error.status, error.code
    return 1008, None


def register_streams(
    app: FastAPI, *, exchange: Exchange | None, authenticator: Authenticator
) -> None:
    @app.websocket("/ws")
    async def stream(socket: WebSocket):
        await socket.accept()
        subscription = None
        tasks = []
        try:
            if exchange is None:
                raise StreamClosed(1013)
            if socket.query_params:
                raise StreamClosed(1008)
            try:
                request = await asyncio.wait_for(
                    message(socket), observations.SUBSCRIBE_TIMEOUT
                )
            except TimeoutError:
                raise StreamClosed(1008) from None
            if (
                set(request) - {"type", "channels", "token"}
                or request.get("type") != "subscribe"
            ):
                raise StreamClosed(1008)
            channels = request.get("channels")
            if (
                not isinstance(channels, list)
                or any(not isinstance(c, str) for c in channels)
                or len(set(channels)) != len(channels)
            ):
                raise StreamClosed(1008)
            identity = None
            if "token" in request:
                identity = authenticator.authenticate(token=request["token"])
            subscription = await exchange.subscribe(
                channels=frozenset(channels), identity=identity
            )

            async def send(text: str):
                await asyncio.wait_for(
                    socket.send_text(text), observations.SEND_TIMEOUT
                )

            async def outgoing():
                for initial in subscription.initial:
                    if subscription.failed.is_set():
                        raise StreamClosed(1013)
                    await send(initial)
                loop = asyncio.get_running_loop()
                deadline = loop.time() + observations.HEARTBEAT_SECONDS
                while True:
                    if loop.time() >= deadline:
                        # Queued behind earlier updates so its baselines never
                        # overtake them.
                        await exchange.heartbeat(subscription)
                        deadline = loop.time() + observations.HEARTBEAT_SECONDS
                    try:
                        update = await asyncio.wait_for(
                            subscription.receive(), max(deadline - loop.time(), 0)
                        )
                    except TimeoutError:
                        continue
                    await send(update)

            async def incoming():
                await message(socket)
                # A connection has exactly one subscription and no order commands.
                raise StreamClosed(1008)

            tasks = [
                asyncio.create_task(outgoing()),
                asyncio.create_task(incoming()),
                asyncio.create_task(subscription.failed.wait()),
            ]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if tasks[2] in done:
                raise StreamClosed(1013)
            for task in done:
                task.result()
        except (AuthenticationFailed, PermissionDenied, TradingError) as error:
            code, reason = rejection(error)
            try:
                await socket.close(code=code, reason=reason)
            except RuntimeError, WebSocketDisconnect:
                pass
        except (StreamClosed, TimeoutError) as error:
            try:
                await socket.close(
                    code=error.code if isinstance(error, StreamClosed) else 1013
                )
            except RuntimeError, WebSocketDisconnect:
                pass
        except WebSocketDisconnect, asyncio.CancelledError:
            pass
        finally:
            for task in tasks:
                task.cancel()
            # ASGI disconnect/shutdown may cancel the enclosing scope. Always
            # finish child-task and subscriber cleanup before returning.
            with anyio.CancelScope(shield=True):
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)
                if subscription is not None:
                    await exchange.unsubscribe(subscription)
