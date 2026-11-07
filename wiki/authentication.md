---
type: Requirements
title: Exchange Authentication
---

# Exchange authentication

Authentication resolves a credential to a trusted internal account identity and
permissions. It does not own funding, balances, or matching. Authentication is
explicitly exempt from Coinbase alignment.

## First milestone

- Exchange API authentication only; website login and registration come later.
  Demonstrate authenticated identity through a small HTTP endpoint without
  implementing trading or exposing unfunded matching to participants.
- Use random opaque tokens in `Authorization: Bearer <token>` headers.
- An operator provisions credentials for predefined internal account IDs through
  private configuration. Real tokens must not be committed.
- Unchanged configured credentials survive restarts, independently of trading
  state resets. Configuration replacement/removal takes effect on restart;
  live key management is deferred.
- Tokens have no automatic expiry in v1. Allow multiple tokens per account,
  each with its own read/trade grants. Removing or replacing one token does not
  invalidate other configured tokens for the same account.
- Support read and trade grants, including read-only credentials. Operations
  enforce permissions and ownership using authenticated identity, not an account
  ID asserted by the caller.
- Bots use the same authentication mechanism. Bot identity/status is assigned by
  the server; it does not itself grant unlimited funding or matching priority.

Credential validation must not reveal token values in identity results, errors,
or logs. See [bearer token usage](https://www.rfc-editor.org/rfc/rfc6750) for the
HTTP convention; adopting it does not require an OAuth login system.

## Possible second version

Email delivery of an authentication token is a candidate next step before a full
user-account experience. An emailed token could be retained and presented for
later authentication. This is a future direction, not part of v1, and does not
yet choose a single-use magic link, token expiry, reissuance/revocation, delivery
limits, or email-provider integration.

Even before full profiles or registration, tokens must map to stable internal
identities so trading ownership remains consistent. How an email maps to that
identity, including repeat requests, remains to be specified for v2.

## Implementation status

Authentication v1 is implemented on `feat/exchange-authentication` (inspected head `4925e41`),
stacked above the matching branch in [PR #5](https://github.com/jakubkuceradev/virtual-exchange/pull/5).
The implementation provides an instance-owned authenticator, hashed private
credential configuration, permission checks, and `GET /identity`; `/health`
remains public. This implementation is in the dedicated worktree, not the
currently inspected main checkout's authentication stub. Funding, reservations,
settlement, and authenticated trading/query endpoints are not implemented by
this PR and require further behavioral specification. See
[public interfaces](/public-interfaces.md) and
[development priorities](/development-priorities.md).
