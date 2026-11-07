---
type: Analysis
title: Coinbase Reference Comparison
---

# Coinbase reference comparison

Reviewed official Coinbase Exchange documentation on 2026-11-07 against the
wiki's matching milestone and later proposals. Following the review, the user
selected Coinbase alignment for the distinctions below except authentication.
This is scoped behavioral alignment, not full API compatibility. Coinbase
Exchange, Advanced Trade, and Derivatives should not
be treated as interchangeable API specifications.

## Matching alignment

Price-time priority, resting-price execution, partial fills, and resting unfilled
quantities align with the [Exchange matching documentation](https://docs.cdp.coinbase.com/exchange/concepts/matching-engine).
Our selected self-trade prevention is now Coinbase's default decrement-and-cancel
(`dc`), replacing the earlier cancel-newest proposal.
The [general trading rules](https://www.coinbase.com/en-gb/legal/trading_rules?locale=en-US)
describe decrement-and-cancel, while the developer documentation lists the
configurable alternatives. For two self-owned remainders, cancel the smaller and
subtract its quantity from the larger; cancel both when equal. Preserve earlier
fills; quantity prevented by this rule creates no execution.

Configured price/quantity increments are consistent with Coinbase's product
metadata, which exposes quote and base increments. Our internal exact-arithmetic
representation remains our design choice. See [product metadata](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-single-product).

## Accounts and settlement

The [trading rules](https://www.coinbase.com/en-gb/legal/trading_rules?locale=en-US),
sections 1.21–1.22 and 1.82, require sufficient available assets plus fees, place
holds when orders are placed, and debit/credit trader balances immediately upon
fills. This supports our proposed funding/reservation/settlement behavior for
later account PRs. It does not reveal Coinbase's internal module architecture.
Our independent matching core and coordinator are project design decisions.

## Adopted alignment and remaining details

| Topic | Coinbase documentation | Project consequence |
| --- | --- | --- |
| Cancelling a finished order | The [cancel endpoint](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/orders/cancel-an-order) errors for already filled/cancelled orders; unmatched cancelled records may be purged. | Adopt errors rather than returning terminal state. Do not guarantee indefinite queryability of unmatched cancelled records; actual internal retention is an implementation choice. |
| Order IDs and retries | [Order creation](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/orders/create-new-order) distinguishes optional client UUIDs from server-assigned IDs. | Adopt distinct exchange IDs and optional client UUIDs. Remove the earlier blanket client-ID lifetime-deduplication requirement; verify duplicate/retry details before specifying the participant API. |
| Submission response | [Order creation](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/orders/create-new-order) acknowledges receipt/acceptance; response arrival can follow feed events. | Adopt acceptance/rejection acknowledgment, separate from subsequent order/fill observations. Do not promise final state, every fill, or crash durability in that response. Internal core calls can still return synchronous outcomes. |
| Privacy | Coinbase's [full WebSocket feed](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels) publishes anonymous executions with maker/taker order IDs. | Adopt public order linkage without account identities. Revise the provisional Trade shape in a later implementation slice. Private participant-linked histories remain private; a website feed panel is not added by this decision. |
| Book depth | [Book snapshots](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-book) distinguish best quotes, aggregated depth, and individual-order depth. | Follow those distinctions when market-data delivery is specified. No requirement to implement every depth or endpoint in the matching milestone. |
| Streaming | [WebSocket channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels) define channel-specific schemas and recovery. | Follow the selected Coinbase channel's semantics in the later data slice, including full-channel snapshot/sequence reconciliation if used. Do not invent uniform guarantees across channels. |
| Credentials | [Exchange REST authentication](https://docs.cdp.coinbase.com/exchange/rest-api/authentication) uses an API key, passphrase, timestamp and HMAC signature, with permissions. | Bearer credentials remain a possible project simplification, not Coinbase Exchange's documented authentication scheme. |

## Scope and evidence limits

One instrument, limit-only orders, one fixed self-trade policy, sequential core
commands, and reset-on-restart are intentional milestone scope. Unlimited bot
funding and competition rankings are project simulation/product rules, not
features justified by this Coinbase comparison.

Public protocol documentation does not prove Coinbase's storage technology,
threading, internal matching/account separation, or exact crash-commit boundary.
Our durability expectations must be specified independently for a later milestone.

The order-creation page also contains inconsistent explanatory wording about
base size versus quote funds. Use the parameter tables, product metadata and
explicit examples together; do not copy ambiguous prose into our own contract.

See [development priorities](/development-priorities.md) for agreed behavior and
[exchange tradeoffs](/exchange-tradeoffs.md) for recommendations still open.
