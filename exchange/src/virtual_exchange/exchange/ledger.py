"""Own funded spot balances and reservations in exact integer units."""

from collections.abc import Iterable, Mapping

from virtual_exchange.amounts import Amounts, units
from virtual_exchange.types import OrderSide, OrderSnapshot
from virtual_exchange.types.matching import Execution


class InsufficientFunds(ValueError):
    """Reject an order without enough unreserved assets."""


class Ledger:
    def __init__(self, allocations: Mapping[str, tuple[int, int]]) -> None:
        self.total = dict(allocations)
        self.held = dict.fromkeys(allocations, (0, 0))

    def fork(self) -> Ledger:
        candidate = Ledger(self.total)
        candidate.held = self.held.copy()
        return candidate

    def reserve(self, account: str, side: OrderSide, ticks: int, lots: int) -> None:
        cash, asset = self.total[account]
        held_cash, held_asset = self.held[account]
        cash_cost, asset_cost = (
            (ticks * lots, 0) if side == OrderSide.BUY else (0, lots)
        )
        if cash - held_cash < cash_cost or asset - held_asset < asset_cost:
            raise InsufficientFunds("insufficient_funds")
        self.held[account] = (held_cash + cash_cost, held_asset + asset_cost)

    def settle(
        self,
        execution: Execution,
        maker: OrderSnapshot,
        taker: OrderSnapshot,
        amounts: Amounts,
    ) -> None:
        buyer, seller = (
            (maker, taker) if maker.side == OrderSide.BUY else (taker, maker)
        )
        lots = units(execution.quantity, amounts.instrument.quantity_increment)
        cash = units(execution.price, amounts.instrument.price_increment) * lots
        buyer_cash, buyer_asset = self.total[buyer.account_id]
        seller_cash, seller_asset = self.total[seller.account_id]
        self.total[buyer.account_id] = (buyer_cash - cash, buyer_asset + lots)
        self.total[seller.account_id] = (seller_cash + cash, seller_asset - lots)

    def reconcile(self, orders: Iterable[OrderSnapshot], amounts: Amounts) -> None:
        # Remaining quantities are authoritative: release execution savings and all
        # removed quantities, leaving exactly the holds required by resting orders.
        held = dict.fromkeys(self.total, (0, 0))
        for order in orders:
            lots = units(
                order.remaining_quantity, amounts.instrument.quantity_increment
            )
            cash, asset = held[order.account_id]
            if order.side == OrderSide.BUY:
                cash += (
                    units(order.limit_price, amounts.instrument.price_increment) * lots
                )
            else:
                asset += lots
            held[order.account_id] = cash, asset
        for account, (cash, asset) in self.total.items():
            hc, ha = held[account]
            if min(cash, asset, hc, ha, cash - hc, asset - ha) < 0:
                raise RuntimeError("inconsistent ledger candidate")
        self.held = held
