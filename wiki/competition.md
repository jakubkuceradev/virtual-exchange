---
type: Requirements
title: Competition and Rankings
---

# Competition and rankings

Competition belongs to the website backend. It consumes published exchange
market/account data; exchange code has no ranking or period dependency. See
[public interfaces](/public-interfaces.md).

The competition runs continuously, with a continuous leaderboard and separate
weekly, monthly, and yearly performance categories. Accounts continue without
resets. Period rankings are intended to give new members a chance to compete.

Portfolio value and risk-adjusted returns are candidate ranking measures.
Neither a final formula nor a choice between them has been agreed.

## Open questions

- Valuation of positions, including assets without recent trades or enough
  liquidity to sell a whole portfolio at the last price.
- Performance formulas and treatment of participants joining during a period.
- Period boundaries and timezone, including calendar versus rolling windows.
- Eligibility rules other than bot exclusion (below).

## Bot exclusion

Operator bots never appear in rankings. Participants' own automation (API
scripts, hosted sandbox strategies on their accounts) is ranked normally.

- **Marker:** the exchange's per-account [funding policy](/trading-slice.md#unlimited-funding).
  Rankings include only `funded` accounts; every `unlimited` account is excluded.
  An account with unlimited money has no meaningful return, so this rule
  holds regardless of who runs the account.
- **Invariant:** every operator bot account is configured `unlimited`. All
  planned bots are. If a funded operator bot is ever needed, add an explicit
  operator-account flag to the exchange configuration and exclude on either
  marker; never infer from names or tokens.
- **Ownership:** the exchange publishes the policy as a fact and knows nothing
  of rankings; the website backend owns the eligibility rule. No separate
  website exclusion list, which could drift from exchange configuration.
- **Delivery:** the policy travels with each row of the exchange's
  `GET /accounts` listing ([account observations](/trading-slice.md#account-observations)),
  so balances never arrive without eligibility.

Rankings are part of the intended project scope and can be established after
the [first working trading slice](/development-priorities.md).
