---
type: Decision
title: Deployment
description: Published images, the single public entry point, browser/API forwarding paths, and VM topology.
tags: [deployment, containers, operations]
---

# Deployment

The site runs at `quant.jakubkuceradev.cz` on the operator's ARM64 VM, which is
shared with another Compose-managed site. Cloudflare terminates public TLS, and
a host-level Caddy routes the hostname to the `website` container. The
`website` container is the **only public entry point**: it serves the frontend
and forwards the exchange API and WebSockets same-origin. Pulling and restarting
on the VM are manual. Operator procedure: `deploy/README.md`.

## Forwarding paths

| Path | Destination |
| --- | --- |
| `/exchange/<path>` (HTTP and WebSocket) | exchange `/<path>`; prefix stripped, so `/exchange/ws` → `/ws` |
| anything else | static frontend build (hash routing; no fallback needed) |

The same rule applies to the browser in local development (Vite dev/preview
proxy, owned by [live website integration](/website-exchange-integration.md))
and on the VM (website image's Caddyfile), so the frontend behaves identically
in both. Participant scripts and bots use the same paths on the public hostname.
The exchange itself stays unprefixed. Changing the prefix means changing the
Vite proxy, `website/frontend/Caddyfile` and `deploy/smoke_test.py` together.

## Images

`exchange`, `website-backend` and `website`, published under
`ghcr.io/jakubkuceradev/virtual-exchange/` for `linux/arm64` (tags and the
workflow: [image publishing](/development.md#image-publishing)). The website
image uses the default live build (`npm run build`), never the mock mode. All run as UID
10001, have a health check, and carry OCI source/revision labels. They contain
no tokens, allocations or other configuration. The GHCR packages are public,
which is safe only because of that.

- `website`: a Node stage builds `npm run build`, and the Caddy runtime serves
  `dist/` and forwards `/exchange/*` to `EXCHANGE_UPSTREAM` (runtime environment
  variable; the container refuses to start without it). Caddy was chosen over
  portfolio's nginx for three reasons: WebSocket upgrades pass through without
  short idle timeouts or buffering, the upstream name is resolved on every dial
  (recreating the exchange container changes its IP), and it runs non-root
  easily. Hashed assets are cached immutably; `index.html` is `no-cache`.
  `/healthz` checks only the website.
- `exchange`: reads `EXCHANGE_AUTH_CONFIG`/`EXCHANGE_TRADING_CONFIG` from a
  read-only mount of an operator-owned directory outside the checkout.
- `website-backend`: health only for now; published so later website APIs ship
  without pipeline changes.

## VM topology

`deploy/compose.yaml` selects all images with one `IMAGE_TAG` (default `main`;
a full sha pins or rolls back; a branch slug tests a manual run). `exchange` and
`website-backend` sit on an internal network with no published ports. `website`
joins that network and publishes only `127.0.0.1:${WEBSITE_PORT:-8080}` for the
host Caddy. `deploy/compose.build.yaml` builds the same topology from source;
the `deployment topology` CI job runs it with the synthetic `deploy/examples/`
config and `deploy/smoke_test.py`.

Deploying a new exchange container resets the in-memory market to the configured
allocations, and clients observe a new `process_id`. Persistence, zero-downtime
deploys, automatic deployment, monitoring, multi-architecture images, and
Caddy/Cloudflare automation are out of scope.
