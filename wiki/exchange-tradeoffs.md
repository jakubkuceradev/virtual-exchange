---
type: Analysis
title: First Slice Realism and Complexity
---

# First-slice realism and complexity

Status: recommendations for discussion, not agreed implementation requirements.
The user asked to weigh realism against introduced complexity, prioritizing
realism. A continuous, fully funded spot order book is a suggested reference
model; real exchanges differ by venue and instrument.

Complexity below is relative to this project's initial trading flow, not an
estimate of implementation time.

| Choice | Realism and tradeoff | Added complexity | Recommendation |
| --- | --- | --- | --- |
| Limit orders | A real order type with a clear maximum buy/minimum sell price. Limit-only scope omits other common order types but preserves realistic supported behavior. | Low | Start here. |
| Partial fills | Orders can execute against several counterparties and price levels. Requiring a complete fill would materially change normal liquidity behavior. | Moderate | Include immediately; track every execution and remaining quantity. |
| Resting remainder | Good-till-cancelled behavior lets unmatched quantities supply liquidity until filled or cancelled. | Low once partial fills exist | Include immediately. |
| Cancellation | Participants need to withdraw unfilled quantities. A fill already processed stands even if a cancellation arrives next. | Moderate | Include ownership checks and deterministic fill/cancel ordering. |
| Matching priority | Price first, then engine receipt order at equal prices is a realistic choice. Other venues use other algorithms. | Low to moderate | Use price-time priority; client timestamps do not establish priority. |
| Execution price | The resting order's price gives a crossing incoming order price improvement. A midpoint would model a different mechanism. | Low | Execute at the resting price, processing best available prices first within the incoming limit. |
| Cash and asset constraints | Fully funded trading is realistic for a spot venue. Borrowing and shorting require a separate credit/risk model. | Moderate for reservations; high for margin | Reserve cash for buys and inventory for sells; release unused reservations. Defer margin. |
| Bot funding | Effectively unlimited money is an intentional simulation exception, already requested by the user. It should not imply matching priority or an automatic exemption from inventory rules. | Low to moderate, mechanism undecided | Keep the exception explicit; decide bot inventory separately. |
| Self-trading | Real venues such as Coinbase prevent an account's orders from executing against one another. | Low to moderate for one fixed policy | Cancel the incoming remainder when it would match the same account. Preserve any earlier fills. Defer configurable policies. |
| API and authentication | REST with authenticated account/order operations is an exchange-like interface. Signed requests more closely match Coinbase's interface than bearer tokens, but add client work. | Moderate | REST/JSON, per-account credentials, ownership enforcement, explicit errors, stable order/trade IDs, and defined duplicate-request handling. Bearer tokens over HTTPS are a possible initial simplification; signing remains open. |
| Market data | Polling snapshots can support a first slice, but a stream better supports reactive trading. Sequence numbers and snapshot recovery matter for reliable streaming. | Low to moderate for snapshots; moderate to high for a robust stream | Initially expose book snapshots, recent trades, own orders/fills, and balances. Add WebSocket updates early; defer FIX. |
| Restart recovery | A continuous competition needs accepted state and account effects to survive crashes consistently. | Moderate to high | Preserve accepted orders, fills, balances, reservations, and queue priority. Commit durable state before confirming success; define safe retry behavior. High availability can follow later. |
| Acceptance examples | Examples specify behavior and expose inconsistent rules before implementation. | Low | Cover multi-price partial fills, equal-price priority, cancellation, insufficient available funds, self-trade prevention, retry, and restart. |

Price and quantity increments should also be explicit. Exact tick/lot arithmetic
avoids rounding creating or destroying money or inventory; selecting the initial
increments is a changeable instrument policy.

## Example under the recommended rules

With distinct funded accounts, the book has a sell for 4 ABC at 99, followed by
a sell for 5 ABC at 100. An incoming buy for 10 ABC at a limit of 100 executes
4 at 99 and 5 at 100, then rests with 1 ABC remaining at 100. Cancelling the
remainder does not undo the nine units bought. At equal prices, earlier engine
receipt determines which resting order fills first.

## Sources and limits

The complexity ratings and scope recommendations are project judgments. The
following primary sources illustrate exchange behavior; they do not establish a
universal exchange standard:

- [Coinbase matching engine](https://docs.cdp.coinbase.com/exchange/concepts/matching-engine) — Price-time priority, resting-price execution, order lifecycle, and self-trade prevention.
- [Coinbase trading rules](https://www.coinbase.com/legal/trading_rules) — Order matching, funding/holds, and settlement rules.
- [Kraken order entry and cancellation](https://support.kraken.com/articles/360039849211-websocket-api-v1-placing-and-cancelling-orders?mode=consumerapp) — Authenticated requests, acknowledgments, and errors.
- [Coinbase API authentication](https://docs.cdp.coinbase.com/exchange/rest-api/authentication) — Keys, signing, and permissions.
- [Coinbase WebSocket channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels) — Data streams and sequence information.

See [development priorities](/development-priorities.md) and
[exchange and bots](/exchange-and-bots.md) for confirmed direction.
