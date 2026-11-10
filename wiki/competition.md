---
type: Decision
title: Competition and Rankings
---

# Competition and rankings

Competition belongs to the website backend. It consumes published exchange
market/account data; exchange code has no ranking or period dependency. See
[public interfaces](/public-interfaces.md).

The competition runs continuously, with a continuous leaderboard and separate
weekly, monthly, and yearly performance categories. Accounts continue without
resets. Period rankings are intended to give new members a chance to compete.

## Decided rules (implemented in `website/backend`)

- **Metric:** plain return V(now) / V(baseline) − 1; no deposits or
  withdrawals exist. Risk-adjusted rankings may be added later as an extra
  category.
- **Valuation:** V = cash + asset × mark, exact Decimal (50 digits), rounded
  only for transport. **Mark:** step-function time-weighted average over the
  trailing 5 minutes of 10-second samples of the book mid; a one-sided or empty
  book samples the last trade price; before any trade with no two-sided book
  nothing is valued. A push during the last sample interval moves the mark by
  at most 1/30 of its effect on the mid.
- **Periods:** continuous (since creation) and calendar week (Monday), month
  and year, starting at 00:00 `Europe/Prague`.
- **Baselines:** V at the period start, valued with the last observation at
  most 30 s before the boundary and the mark at the boundary. Accounts created
  later start at their first valued observation with zero fills. Missing the
  boundary (backend down, no mark) uses the first valued observation after it
  and logs the gap.
- **Eligibility:** `funded` accounts whose exchange `fill_count` rose during
  the period (continuous: ever) with a positive baseline. Others are unranked
  and uncounted, with reason `not_funded`, `no_fills` or `no_valuation`.
- **Ranking:** by return, highest first; exact ties share a rank (1, 2, 2, 4).
  Participants appear by account ID until registration adds names.
- **Privacy:** public output is rank, account ID and return only.
- **History:** at each period end the final standings are frozen and kept;
  the caller's value is kept every 10 minutes for one year.

The backend polls `GET /accounts` (exchange `observe_accounts` grant) and the
public book and trades every 10 s, writes each tick to its own SQLite store,
and recomputes rankings on every tick. Operation and API:
[development setup](/development.md#website-backend).

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
