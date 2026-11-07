---
type: Requirements
title: Funded Trading Slice
---

# Funded trading slice

Complete the first end-to-end trading slice by combining authenticated identity,
account funding, reservations, matching, settlement, and trading/query endpoints.
Authentication is implemented separately. Endpoint and retry behavior are still
being specified.

## Inspected implementation status

On 2026-11-07, the dedicated `exchange-trading` worktree has funded operations
and REST trading/query adapters committed through `8d78755`. Its current
`feat/exchange-trading-streams` branch also contains uncommitted WebSocket and
observation changes. These observations establish source presence, not completed
stream acceptance verification. The main checkout still contains the scaffold.
The local behavioral spec and architecture notes lag some of that implementation;
reconcile them with the delivered contracts before frontend integration.

## Live updates

WebSockets are included in the first end-to-end slice where live updates are
useful: public order-book and anonymous trade updates, plus authenticated updates
to the caller's own orders and fills. REST remains the command/query interface
for order submission/cancellation, snapshots, balances, and history. This
supersedes the earlier polling-only proposal and streaming exclusion. The chosen
transport split follows Coinbase Exchange: order submission/cancellation stays
on REST; WebSockets deliver observations, not order commands. FIX order entry is
deferred and is not required for this milestone.

The exact channel schemas, subscription authentication, snapshot/update handoff,
reconnect recovery, permissions, and slow-client behavior still need definition.
Use the relevant [Coinbase channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels)
as reference, preserving our independent bearer-token authentication choice.

## Agreed account behavior

- Operator configuration supplies starting cash and asset holdings per account.
  Restart restores those allocations with an empty order book and no previous
  orders/fills. No deposit or withdrawal endpoints are included.
- Fully funded spot trading only: no borrowing, shorting, negative available
  balances, or fees in this slice.
- Bots use ordinary funded accounts initially. Unlimited-funding exceptions are
  deferred, rather than inferred from authentication or bot metadata.
- Before accepting a buy, reserve limit price multiplied by quantity. Before
  accepting a sell, reserve its asset quantity. A balance check alone is not
  sufficient; open orders share the same available funds.
- Settle every execution immediately at its actual price. Transfer cash to the
  seller and inventory to the buyer, consuming the appropriate reservations.
- Release buy-price savings and reservations removed by cancellation or
  decrement-and-cancel self-trade prevention. Prevented quantities are not trades.
  Retain the reservations required for quantities still resting.

Use exact arithmetic and preserve in-process consistency across complete order
operations. Funding policy must not leak into the matching core or require HTTP
handlers to coordinate reserve/match/settle steps. See
[architecture principles](/architecture-principles.md).

## Remaining specification

Trading/query scope, read/trade permission mapping, foreign-resource errors,
client-ID reconciliation and retry behavior, and query history/pagination need
agreement. Concrete endpoint shapes will follow the agreed behavior and
[Coinbase reference](/coinbase-reference.md).

Persistence, website integration, and rankings remain outside this
slice. See [development priorities](/development-priorities.md) and
[authentication](/authentication.md).
