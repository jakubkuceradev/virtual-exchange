---
type: Reference
title: Exchange Authentication
---

# Exchange authentication

The exchange resolves operator-provisioned opaque bearer tokens to trusted account
IDs and independent `read`, `trade` and `publish_news` grants ([market news](/market-news.md)). Authentication owns no balances, bot
funding, or matching policy. Registration, browser sessions, email delivery,
automatic expiry, and live credential management are deferred.

## HTTP and callable contract

`GET /identity` accepts `Authorization: Bearer <token>` and returns only
`account_id` and a sorted `permissions` list, with `Cache-Control: no-store`.
Any configured credential can inspect its identity, including trade-only and
zero-grant tokens. Request account IDs cannot override authenticated identity.

Private requests without a header receive 401,
`{"error": "authentication_required"}` and `WWW-Authenticate: Bearer realm="exchange"`.
Malformed, duplicate-header, unknown, or removed credentials receive 401 and the
same generic `{"error": "invalid_token"}` body, with `error="invalid_token"` in
the challenge. Query/form credentials are unsupported.
Scheme matching is case-insensitive; token matching is exact and case-sensitive.
A valid identity missing an operation's grant receives 403,
`{"error": "insufficient_scope"}` and a bearer challenge naming the required scope. This project selects
401 for malformed credentials; it does not implement a 400 invalid_request path.
See [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-3.1).

`GET /health` ignores optional credentials, including invalid ones. Funded trading and public observations use the configured Exchange; see
[funded trading](/trading-slice.md). Permission dependencies are tested
with a test-only protected operation, not a production trading endpoint.

`virtual_exchange.auth.Authenticator.authenticate(token=...)` returns the frozen
`AuthenticatedIdentity` or raises generic `AuthenticationFailed`.
`require_permission(identity=..., permission=Permission.TRADE)` enforces exactly
that grant or raises `PermissionDenied`. Trade does not imply read, and grants
from different tokens for one account are never combined. Future operations
must enforce ownership using the trusted account ID, not a request account ID.
`http_auth.identity_dependency` and `permission_dependency` adapt these checks
for FastAPI. `create_app(authenticator=...)` supports explicit instance injection.

## Private configuration and lifecycle

Set `EXCHANGE_AUTH_CONFIG` to a private UTF-8 JSON file before starting the app:

```json
{"version": 1, "credentials": [
  {"token_sha256": "<64 lowercase hexadecimal characters>",
   "account_id": "alice", "permissions": ["read", "trade"]}
]}
```

This is a placeholder, not valid provisioned credentials. Operators generate
random tokens offline with `secrets.token_urlsafe(32)` and hash their exact ASCII
bytes with `hashlib.sha256(token.encode("ascii")).hexdigest()`. Give the raw token
to the client through a private channel; store only its hash in configuration.
Use generated random tokens, not human passwords. Multiple distinct hashes may
map to the same predefined account with different grants; no automatic expiry
is applied. Bot credentials work identically and confer no funding exception.

`Authenticator.from_config(path=...)` validates the complete file before making
an immutable snapshot. Invalid schema, unknown grants, duplicate keys/hashes,
unreadable files, and malformed contents fail startup with sanitized diagnostics.
An unset path or an explicitly empty credentials list starts an empty registry:
health works, all private authentication fails, and no default token is created.

The app loads once at construction. File changes/removal leave an existing app
unchanged; new instances load the new configuration. Removing one token leaves
other tokens for that account independent. Unchanged config survives restart,
even though matching state currently resets. Keep files outside checkouts with
restricted operator access; never commit them, put raw tokens in URLs, log
Authorization headers, or bake credentials into images. Use HTTPS for deployment;
loopback HTTP is suitable for local development. Configure reverse-proxy and
application logging to omit credentials; TLS/proxy behavior is not proven by
local TestClient tests.

## Container configuration

The default Compose stack needs no credentials and denies private access. To
configure auth, place an override file outside the checkout, replacing the host
path with a private file readable by container UID 10001:

```yaml
services:
  api:
    environment:
      EXCHANGE_AUTH_CONFIG: /run/exchange/auth.json
    volumes:
      - type: bind
        source: /absolute/private/path/auth.json
        target: /run/exchange/auth.json
        read_only: true
        bind:
          create_host_path: false
```

Run `docker compose -f compose.yaml -f /absolute/private/path/auth-override.yaml up --build --wait`.
Recreate the API container after credential changes; merely editing the file does
not reload a running app. Do not broaden host file permissions to solve container
access; arrange access for the runtime UID or an appropriate private mount.

## Verification

`uv run --project exchange --locked pytest exchange/tests/test_auth.py` exercises
the real app, loader, authenticator, and permission dependencies using synthetic
credentials. It covers identity/grants, HTTP challenges, attempted account
spoofing, absence of token echo, public health, independent token replacement,
restart snapshots, no expiry, invalid configuration, and sanitized failures.
