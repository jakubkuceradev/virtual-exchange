"""The backend's only view of the exchange: its published HTTP API."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

import httpx2


class ExchangeUnavailable(RuntimeError):
    """The exchange did not answer, or answered with an unexpected response."""


class IdentityRejected(Exception):
    """The exchange rejected the caller's credentials; carries its status."""

    def __init__(self, status: int, body: dict) -> None:
        super().__init__(status)
        self.status = status
        self.body = body


@dataclass(frozen=True, slots=True)
class AccountRow:
    """One account in an exchange `/accounts` listing."""

    account_id: str
    funded: bool
    created_at: datetime
    cash: Decimal
    asset: Decimal
    fill_count: int


class ExchangeClient:
    """Read published exchange facts over HTTP.

    The observer token needs only the exchange's `observe_accounts` grant.
    """

    def __init__(self, client: httpx2.AsyncClient, observer_token: str) -> None:
        self._client = client
        self._observer = {"Authorization": "Bearer " + observer_token}

    async def _get(self, path: str, **kwargs) -> httpx2.Response:
        try:
            return await self._client.get(path, **kwargs)
        except httpx2.HTTPError as error:
            raise ExchangeUnavailable(f"GET {path}: {error}") from None

    async def _json(self, path: str, **kwargs) -> dict:
        response = await self._get(path, **kwargs)
        if response.status_code != 200:
            raise ExchangeUnavailable(f"GET {path}: HTTP {response.status_code}")
        return response.json()

    async def accounts(self) -> tuple[AccountRow, ...]:
        """Every account at one exchange commit."""
        body = await self._json("/accounts", headers=self._observer)
        try:
            return tuple(
                AccountRow(
                    row["account_id"],
                    row["funding"] == "funded",
                    datetime.fromisoformat(row["created_at"]),
                    Decimal(row["cash"]),
                    Decimal(row["asset"]),
                    int(row["fill_count"]),
                )
                for row in body["data"]
            )
        except (KeyError, TypeError, ValueError, ArithmeticError) as error:
            raise ExchangeUnavailable(f"malformed /accounts: {error!r}") from None

    async def price(self) -> Decimal | None:
        """The book mid when two-sided, else the last trade price, else None."""
        book = (await self._json("/book"))["data"]
        bids = [Decimal(level["price"]) for level in book["bids"]]
        asks = [Decimal(level["price"]) for level in book["asks"]]
        if bids and asks:
            return (max(bids) + min(asks)) / 2
        trades = (await self._json("/trades", params={"limit": 1}))["data"]
        return Decimal(trades[0]["price"]) if trades else None

    async def identity(self, authorization: str) -> str:
        """Resolve a caller's Authorization header to their exchange account."""
        response = await self._get(
            "/identity", headers={"Authorization": authorization}
        )
        if response.status_code in (401, 403):
            raise IdentityRejected(response.status_code, response.json())
        if response.status_code != 200:
            raise ExchangeUnavailable(f"GET /identity: HTTP {response.status_code}")
        return response.json()["account_id"]
