---
type: Requirements
title: Exchange and Bots
---

# Exchange and bots

The exchange should be primarily Python, with realistic order matching and an
exchange-like public API simplified for ease of use. Authenticated participants
submit bids and asks that match against other participants and bots.
Compatibility with a particular existing exchange API has not been required.

## Technical reference

Use official Coinbase Exchange documentation as a primary reference for
technical choices, including order lifecycle, matching, funding/holds,
authentication, and market-data behavior. Consult the relevant documentation
when specifying a choice; cite it and record deliberate simplifications or
departures. Project requirements and agreed scope remain authoritative. This
does not require Coinbase API compatibility or adoption of every feature or
default policy.

For the behaviors reviewed in [the reference comparison](/coinbase-reference.md),
match Coinbase's self-trade default, cancellation semantics, order/client ID
distinction, acceptance acknowledgment, and anonymous market-data linkage.
Authentication is explicitly exempt and remains a project choice. This does
not expand the first milestone beyond the agreed in-memory matching core.

See the [reference comparison](/coinbase-reference.md) for verified alignment,
deliberate differences, and documentation limits.

- [Matching engine](https://docs.cdp.coinbase.com/exchange/concepts/matching-engine)
  — Price-time priority, resting-price execution, and self-trade options.
- [Trading rules](https://www.coinbase.com/en-gb/legal/trading_rules?locale=en-US)
  — Order behavior and funding requirements.
- [API authentication](https://docs.cdp.coinbase.com/exchange/rest-api/authentication)
  and [WebSocket feed](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels)
  — References for later interface decisions, not selected requirements.

## Assets and price formation

Assets are fictional. The desired direction is for prices to be determined
entirely by trades. Executions establish last-traded prices; resting orders
establish quotes. There is no last-traded price before an asset's first trade,
and the last price can become stale during quiet periods. Initial bot orders
can supply liquidity, but the initial quoting policy remains undecided. The
last-traded price can differ from the prices available for immediate execution.

Initial instruments, liquidity, participant cash and asset allocation, borrowing,
shorting, fees, and valuation policy remain open. Initial balances should not
block the [first vertical slice](/development-priorities.md).

## Private bot population

Bots will populate the order book and try to steer prices toward realistic
behavior through trading. Planned roles are market makers, speculators, retail
traders, and whales. Strategies and special authentication details belong in a
separate private repository.

Bots obey essentially the same trading rules as participants, with effectively
unlimited money as the main exception. How this funding is represented, whether
it extends to asset inventory, and any other exceptions remain undecided.
Special authentication does not yet imply any defined additional permissions.

Whether bots use internal reference prices is unresolved. Such a reference
would be a bot strategy input, distinct from an executed market price.

## Interfaces still to define

The [authentication milestone](/authentication.md) selects operator-provisioned
bearer tokens, read/trade grants, and the same mechanism for bots. Exact trading
endpoints, request limits, and bot funding/status details remain open.
Market-data depth, history, and streaming versus
polling are undecided, as are the initial participant interfaces. See
[conceptual responsibilities](/project-scope.md#conceptual-responsibilities).
