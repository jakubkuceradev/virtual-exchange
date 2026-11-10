---
type: Requirements
title: Exchange and Bots
---

# Exchange and bots

The exchange should be primarily Python, with realistic order matching and an
exchange-like public API simplified for ease of use. Authenticated participants
submit bids and asks that match against other participants and bots.
Compatibility with a particular existing exchange API has not been required.

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
unlimited money as the main exception. The operator marks such accounts
`funding: unlimited` in configuration; both cash and asset may then go negative
while settlement records the net position. See
[unlimited funding](/trading-slice.md#unlimited-funding). Other exceptions remain
undecided.
Special authentication does not yet imply any defined additional permissions.

Whether bots use internal reference prices is unresolved. Such a reference
would be a bot strategy input, distinct from an executed market price.

## Interfaces still to define

API transport, credentials, endpoints, request limits, and bot-account
identification remain open. Market-data depth, history, and streaming versus
polling are undecided, as are the initial participant interfaces. See
[conceptual responsibilities](/project-scope.md#conceptual-responsibilities).
