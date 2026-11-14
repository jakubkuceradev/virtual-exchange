---
type: Reference
title: Deployment Images
description: What the exchange, website-backend and website images expect at runtime, the /exchange forwarding rule, and how they are published.
tags: [deployment, containers]
---

# Deployment images

This repository builds and publishes three images and owns their runtime
contract. Where and how they run is the operator's concern and lives in the
operator's private infrastructure repository, not here.

## Image contract

All images run as UID/GID 10001, have a Docker health check, carry the OCI
`source` label (published images also `revision`), and contain **no
configuration**: no tokens, allocations, hostnames or other deployment values.
That is why their GHCR packages may be public.

| Image | Listens | Health | Runtime input | State volume |
| --- | --- | --- | --- | --- |
| `exchange` | 8000 | `GET /health` | `EXCHANGE_AUTH_CONFIG`, `EXCHANGE_TRADING_CONFIG` | `/var/lib/virtual-exchange` (`EXCHANGE_STATE_DIR`, set by the image) |
| `website-backend` | 8000 | `GET /health` | `WEBSITE_STATE_DIR`, `WEBSITE_EXCHANGE_TOKEN_FILE`, `WEBSITE_EXCHANGE_URL` | `/var/lib/virtual-exchange-website` when `WEBSITE_STATE_DIR` points there |
| `website` | 8080 | `GET /healthz` (website only) | `EXCHANGE_UPSTREAM`, `WEBSITE_BACKEND_UPSTREAM` (both required) | none |

- **exchange:** each variable names a JSON file
  ([authentication](/authentication.md), [funded trading](/trading-slice.md))
  that must be readable by UID 10001; mount it read-only. Without
  `EXCHANGE_AUTH_CONFIG` no token authenticates; without
  `EXCHANGE_TRADING_CONFIG` trading routes are unavailable. With a trading
  configuration, the exchange needs an initialised store in its state volume
  (`python -m virtual_exchange.admin init-store`, once) and refuses to start
  without one. Configuration only seeds a store: later starts keep persisted
  balances, give new accounts their allocation, and refuse a changed instrument
  or a changed funding policy of an existing account. A new container
  recovers the market; only `process_id` changes. A failed store write stops
  the process, so run it with a restart policy
  ([persistence](/persistence.md)).
- **website-backend:** without `WEBSITE_STATE_DIR` it serves health only and
  the competition routes return 503. With it, the backend needs an initialised
  store (`python -m pqc_website.admin init-store`, once), a file holding a token
  with the exchange's `observe_accounts` grant, and the exchange URL
  ([competition](/competition.md), [development](/development.md#competition-service)).
- **website:** Caddy serves the default live frontend build (`npm run build`,
  never mock mode) and forwards `/exchange/*` to `EXCHANGE_UPSTREAM` and
  `/website/*` to `WEBSITE_BACKEND_UPSTREAM` (`host:port`). The container
  refuses to start without both. Upstream names are resolved on every dial, so
  recreating either container is safe.
  Hashed assets are cached immutably; `index.html` is `no-cache`. Caddy was
  chosen for WebSocket pass-through without short idle timeouts or buffering
  and for easy non-root operation.

## Forwarding paths

| Path | Destination |
| --- | --- |
| `/exchange/<path>` (HTTP and WebSocket) | exchange `/<path>`; prefix stripped, so `/exchange/ws` → `/ws` |
| `/website/<path>` | website backend `/<path>`, prefix stripped |
| anything else | static frontend build (hash routing; no fallback needed) |

The Vite dev/preview proxy ([public interfaces](/public-interfaces.md)) and the
website image's `website/frontend/Caddyfile` apply the same rules, so the
frontend behaves identically locally and deployed. Scripts and bots use the same
paths on the public origin; the services themselves stay unprefixed. Changing a
prefix means changing both proxies together.

## Publishing and checks

`.github/workflows/publish.yml` builds `linux/arm64` images to
`ghcr.io/jakubkuceradev/virtual-exchange/<image>`, each image whose build
context has a Dockerfile at the commit. A push to `main` publishes `:main` and
`:<full-sha>`; a manual run from another branch publishes `:<branch-slug>` and
`:<full-sha>` and never moves `:main`. The moving tag is retagged for all images
only after every build succeeded. A full SHA pins or rolls back a deployment.

The `container` job in Checks builds all three from source through the root
`compose.yaml` and verifies health, non-root users, labels, and that the website
serves the frontend and forwards `/exchange/health` and `/website/health` with
the prefix stripped. It runs without trading configuration, so no store is
needed.
