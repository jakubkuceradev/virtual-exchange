import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Live acceptance suite: real exchange processes (started per test by the
 * `exchange` fixture, each with a fresh persistent store) and, where a test
 * asks for it, the real website backend (`website` fixture), behind the real
 * Vite preview proxy, driven through isolated browser contexts. Requires
 * `npm run build` (live mode) and uv.
 *
 * Synthetic configuration is generated once per run into a private temp
 * directory; workers inherit its location through the environment.
 */
const PREVIEW_PORT = 4176;
const EXCHANGE_PORT = 18_000;
const WEBSITE_PORT = 18_001;

if (!process.env.LIVE_DIR) {
  const dir = mkdtempSync(join(tmpdir(), 'vx-live-'));
  const grants: Record<string, [string, string[]]> = {
    alice: ['alice', ['read', 'trade']],
    bob: ['bob', ['read', 'trade']],
    aliceRead: ['alice', ['read']],
    aliceTrade: ['alice', ['trade']],
    carol: ['carol', ['read', 'trade']],
    // The website backend's service identity: account listing only.
    observer: ['website', ['observe_accounts']],
  };
  const tokens = Object.fromEntries(
    Object.keys(grants).map((name) => [
      name,
      randomBytes(32).toString('base64url'),
    ]),
  );
  const write = (name: string, value: unknown) =>
    writeFileSync(join(dir, name), JSON.stringify(value), { mode: 0o600 });
  write('auth.json', {
    version: 1,
    credentials: Object.entries(grants).map(
      ([name, [account, permissions]]) => ({
        token_sha256: createHash('sha256')
          .update(tokens[name] ?? '')
          .digest('hex'),
        account_id: account,
        permissions,
      }),
    ),
  });
  write('trading.json', {
    version: 1,
    instrument: {
      instrument_id: 'QC-EUR',
      base_asset: 'QC',
      quote_asset: 'EUR',
      price_increment: '0.01',
      quantity_increment: '0.1',
    },
    accounts: {
      alice: { cash: '1000', asset: '0' },
      bob: { cash: '0', asset: '10' },
    },
  });
  write('tokens.json', tokens);
  process.env.LIVE_DIR = dir;
  process.env.LIVE_EXCHANGE_PORT = String(EXCHANGE_PORT);
  process.env.LIVE_WEBSITE_PORT = String(WEBSITE_PORT);
}

export default defineConfig({
  testDir: './e2e-live',
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
    url: `http://127.0.0.1:${PREVIEW_PORT}`,
    reuseExistingServer: false,
    env: {
      EXCHANGE_URL: `http://127.0.0.1:${EXCHANGE_PORT}`,
      WEBSITE_BACKEND_URL: `http://127.0.0.1:${WEBSITE_PORT}`,
    },
  },
});
