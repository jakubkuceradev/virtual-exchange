"""Own spot balances, reservations and funding policy in exact integer units."""

from collections.abc import Iterable, Mapping

from virtual_exchange.amounts import Amounts, units
from virtual_exchange.types import OrderSide, OrderSnapshot
from virtual_exchange.types.matching import Execution


class InsufficientFunds(ValueError):
    """Reject an order without enough unreserved assets."""


class Ledger:
    """Unlimited accounts keep the same holds and settlement but are never
    limited by funds, so their balances and available amounts may go negative."""

    def __init__(
        self,
        allocations: Mapping[str, tuple[int, int]],
        unlimited: frozenset[str] = frozenset(),
    ) -> None:
        self.total = dict(allocations)
        self.held = dict.fromkeys(allocations, (0, 0))
        self.unlimited = unlimited

    def fork(self) -> Ledger:
        candidate = Ledger(self.total, self.unlimited)
        candidate.held = self.held.copy()
        return candidate

    def reserve(self, account: str, side: OrderSide, ticks: int, lots: int) -> None:
        cash, asset = self.total[account]
        held_cash, held_asset = self.held[account]
        cash_cost, asset_cost = (
            (ticks * lots, 0) if side == OrderSide.BUY else (0, lots)
        )
        if account not in self.unlimited and (
            cash - held_cash < cash_cost or asset - held_asset < asset_cost
        ):
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

    def reconcile(self, open_orders: Iterable[OrderSnapshot], amounts: Amounts) -> None:
        # Holds are derived, not verified: open-order remainders are authoritative,
        # which releases execution savings and all removed quantities and leaves
        # exactly the holds resting orders require. The pass then rejects any
        # candidate whose balances or holds would be negative or overcommitted.
        held = dict.fromkeys(self.total, (0, 0))
        for order in open_orders:
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
            bounded = (hc, ha)
            if account not in self.unlimited:
                bounded += (cash, asset, cash - hc, asset - ha)
            if min(bounded) < 0:
                raise RuntimeError("inconsistent ledger candidate")
        self.held = held
