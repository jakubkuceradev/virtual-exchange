import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Browser, type Page, test as base, expect } from '@playwright/test';

const dir = process.env.LIVE_DIR ?? '';
const port = Number(process.env.LIVE_EXCHANGE_PORT ?? 18000);
export const tokens: Record<
  'alice' | 'bob' | 'aliceRead' | 'aliceTrade' | 'carol',
  string
> = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));

/** A real exchange process on the port the preview proxy forwards to. */
export class Exchange {
  private process: ChildProcess | null = null;

  async start() {
    const root = resolve(import.meta.dirname, '../../..');
    this.process = spawn(
      'uv',
      [
        'run',
        '--project',
        join(root, 'exchange'),
        '--locked',
        'uvicorn',
        'virtual_exchange.api:create_app',
        '--factory',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--no-access-log',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          EXCHANGE_AUTH_CONFIG: join(dir, 'auth.json'),
          EXCHANGE_TRADING_CONFIG: join(dir, 'trading.json'),
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Exchange did not start');
  }

  async stop() {
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGTERM');
    await exited;
  }

  async restart() {
    await this.stop();
    await this.start();
  }
}

/** REST call through the same preview proxy the browser uses. */
export async function api(
  baseURL: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
) {
  const response = await fetch(`${baseURL}/exchange${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

export const order = (side: 'buy' | 'sell', price: string, quantity: string) => ({
  instrument_id: 'QC-EUR',
  side,
  price,
  quantity,
  client_order_id: crypto.randomUUID(),
});

/** A participant in an isolated browser context, connected with a token. */
export async function participant(browser: Browser, token: string | null, view = 'trade') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#account');
  if (token) await connect(page, token);
  await page.goto(`/#${view}`);
  return { page, context, errors };
}

export async function connect(page: Page, token: string) {
  await page.goto('/#account');
  await page.getByLabel('API token').fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('#connection-status')).not.toContainText('Connecting');
}

export const test = base.extend<{ exchange: Exchange }>({
  exchange: async ({}, use) => {
    const exchange = new Exchange();
    await exchange.start();
    await use(exchange);
    await exchange.stop();
  },
});
export { expect };
