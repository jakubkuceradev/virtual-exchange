# VM deployment

Runs the published images on the VM behind the host Caddy and Cloudflare.
Pulling and restarting are manual. Design and rationale:
[wiki/deployment.md](../wiki/deployment.md).

```
Cloudflare (TLS, proxied hostname)
  └─ host Caddy  quant.jakubkuceradev.cz → 127.0.0.1:8080
       └─ website        static app  +  /exchange/* → exchange:8000  (prefix stripped)
            private network (internal, no host ports)
              ├─ exchange          in-memory market, config mounted read-only
              └─ website-backend   health only
```

Participants use the site in a browser. Scripts and bots use the same hostname:
`https://quant.jakubkuceradev.cz/exchange/<path>` (for example `/exchange/identity`,
`/exchange/orders`) and `wss://quant.jakubkuceradev.cz/exchange/ws`. There is no
separate exchange port.

## Files on the VM

Keep the repository checkout (or just `deploy/compose.yaml`) and the private
configuration directory separate. The configuration directory belongs to the
operator and is never inside the checkout:

```
/srv/virtual-exchange/config/        # EXCHANGE_CONFIG_DIR, mode 0750
  auth.json                          # credential hashes, mode 0640
  trading.json                       # instrument and allocations, mode 0640
/srv/virtual-exchange/.env           # deployment variables (not secret)
```

The containers run as UID 10001, so make both files readable by that UID
without making them world-readable:

```sh
sudo install -d -m 0750 -g 10001 /srv/virtual-exchange/config
sudo chgrp 10001 /srv/virtual-exchange/config/*.json
sudo chmod 0640 /srv/virtual-exchange/config/*.json
```

- `auth.json` holds only SHA-256 hashes of tokens. The format and token
  generation are described in [wiki/authentication.md](../wiki/authentication.md).
  Hand raw tokens to participants privately. They never go into this
  repository, an image, or a log.
- `trading.json` defines the instrument and the starting allocations; see
  [wiki/trading-slice.md](../wiki/trading-slice.md).
- [examples/](examples/) contains synthetic versions for local testing only.
  Their tokens are public (`synthetic-alice-token-not-secret`,
  `synthetic-bob-token-not-secret`, `synthetic-alice-readonly-not-secret`), so
  never deploy them to the public host.
- On SELinux hosts, label the directory for containers:
  `chcon -R -t container_file_t /srv/virtual-exchange/config`.

`.env` (used with `--env-file`):

```sh
EXCHANGE_CONFIG_DIR=/srv/virtual-exchange/config
IMAGE_TAG=main          # or a full commit sha, or a branch slug from a manual run
WEBSITE_PORT=8080       # loopback port the host Caddy proxies to
```

## Host Caddy and Cloudflare

Add a site block to the host Caddyfile and reload Caddy:

```caddyfile
quant.jakubkuceradev.cz {
	reverse_proxy 127.0.0.1:8080
}
```

`reverse_proxy` passes WebSocket upgrades through and applies no short idle
timeout. The exchange sends a heartbeat every 10 s, well below Cloudflare's idle
limit. Caddy redacts `Authorization` in access logs by default; keep it that way.
If you run Caddy in a container rather than on the host, attach `website` to
Caddy's network and drop the `ports` entry instead.

In Cloudflare, the `quant` DNS record must be **proxied**, and **WebSockets** must
be enabled under Network. Use the same SSL/TLS mode as the portfolio hostname.

## First deployment

1. Make the three GHCR packages public (once, after the first publish): on
   GitHub, go to Packages → `virtual-exchange/exchange`, `…/website`,
   `…/website-backend` → Package settings → Change visibility → Public. After
   that the VM pulls without logging in.
2. Create the config directory and `.env` as above.
3. Start the stack:

   ```sh
   cd /path/to/virtual-exchange
   docker compose --env-file /srv/virtual-exchange/.env -f deploy/compose.yaml pull
   docker compose --env-file /srv/virtual-exchange/.env -f deploy/compose.yaml up -d --wait
   ```

4. Add the Caddy site block and check the public hostname (see Health).

To save typing:
`alias vx='docker compose --env-file /srv/virtual-exchange/.env -f /path/to/virtual-exchange/deploy/compose.yaml'`.
The examples below use it.

## Update to a new tag

Published tags are `:main` (latest `main`), `:<full-sha>` (immutable), and
`:<branch-slug>` (from a manual workflow run on that branch). Set `IMAGE_TAG` in
`.env`, then:

```sh
vx pull
vx up -d --wait
```

To keep `:main` but pick up a newer build, run the same two commands unchanged.
Before an update, note the running commit for rollback:

```sh
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  virtual-exchange-exchange-1
```

**Every new exchange container resets the market.** The exchange keeps all state
in memory, so recreating it restarts from the configured allocations. All
orders, fills and trade history are lost, and connected clients see a new
`process_id`. Credentials keep working. There is no persistence or
zero-downtime deploy yet. To change only the website, use `vx up -d --wait website`.

## Roll back

Set `IMAGE_TAG=<previous full sha>` in `.env` and run `vx pull && vx up -d --wait`.
Rolling back recreates the exchange, so it also resets the market.

## Health and logs

```sh
vx ps                                 # all three should be "healthy"
vx logs -f --tail 100 website exchange
curl -fsS http://127.0.0.1:8080/exchange/health
```

From any machine, with a real read-capable token in the environment (never as
an argument):

```sh
SMOKE_TOKEN=... uv run --project exchange --locked python deploy/smoke_test.py \
  https://quant.jakubkuceradev.cz --heartbeats 5
```

The smoke test checks the app shell, the exchange path, authenticated `/identity`,
and a WebSocket snapshot that stays open across the given number of heartbeats.

## Local verification

Run the same layout from source with the synthetic examples:

```sh
export EXCHANGE_CONFIG_DIR="$PWD/deploy/examples"
docker compose -f deploy/compose.yaml -f deploy/compose.build.yaml up --build --wait
uv run --project exchange --locked python deploy/smoke_test.py http://127.0.0.1:8080
docker compose -f deploy/compose.yaml -f deploy/compose.build.yaml down
```

To try published images locally, drop `-f deploy/compose.build.yaml` and set
`IMAGE_TAG`. On an x86 machine this needs QEMU, because the images are `linux/arm64` only.
