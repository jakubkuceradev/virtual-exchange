FROM node:26.13.0-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM caddy:2.11.9-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/jakubkuceradev/virtual-exchange"
ENV XDG_CONFIG_HOME=/tmp/caddy-config \
    XDG_DATA_HOME=/tmp/caddy-data
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
# Upstream addresses are runtime configuration; refuse to start without them.
CMD ["sh", "-c", ": \"${EXCHANGE_UPSTREAM:?EXCHANGE_UPSTREAM must name the exchange host:port}\" \"${WEBSITE_BACKEND_UPSTREAM:?WEBSITE_BACKEND_UPSTREAM must name the website backend host:port}\" && exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
