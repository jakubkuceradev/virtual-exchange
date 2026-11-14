import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Browser, type Page, test as base, expect } from '@playwright/test';

const dir = process.env.LIVE_DIR ?? '';
const port = Number(process.env.LIVE_EXCHANGE_PORT ?? 18000);
const websitePort = Number(process.env.LIVE_WEBSITE_PORT ?? 18001);
const root = resolve(import.meta.dirname, '../../..');
export const tokens: Record<
  'alice' | 'bob' | 'aliceRead' | 'aliceTrade' | 'carol' | 'observer' | 'publisher',
  string
> = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));

/** Create an empty store with a project's admin command; it never self-creates. */
function initStore(project: string, module: string, stateDir: string) {
  const result = spawnSync(
    'uv',
    ['run', '--project', join(root, project), '--locked', 'python', '-m', module, '--state-dir', stateDir, 'init-store'],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`init-store failed: ${result.stderr}`);
}

async function healthy(url: string, what: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`${what} did not start`);
}

async function terminate(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  await exited;
}

/**
 * A real exchange process on the port the preview proxy forwards to. Each
 * instance has its own store, so a restart keeps committed state.
 */
export class Exchange {
  private process: ChildProcess | null = null;
  private readonly stateDir = mkdtempSync(join(dir, 'exchange-'));

  constructor() {
    initStore('exchange', 'virtual_exchange.admin', this.stateDir);
  }

  async start() {
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
          EXCHANGE_STATE_DIR: this.stateDir,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    await healthy(`http://127.0.0.1:${port}/health`, 'Exchange');
  }

  async stop() {
    const child = this.process;
    this.process = null;
    await terminate(child);
  }

  async restart() {
    await this.stop();
    await this.start();
  }
}

/**
 * The real website backend, sampling the exchange with the observer token.
 * Its sampler ticks every 10 s, so rankings appear within a tick of trading.
 */
export class Website {
  private process: ChildProcess | null = null;
  private readonly stateDir = mkdtempSync(join(dir, 'website-'));

  async start() {
    initStore('website/backend', 'pqc_website.admin', this.stateDir);
    const tokenFile = join(this.stateDir, 'observer.token');
    writeFileSync(tokenFile, tokens.observer, { mode: 0o600 });
    this.process = spawn(
      'uv',
      [
        'run',
        '--project',
        join(root, 'website/backend'),
        '--locked',
        'uvicorn',
        'pqc_website.api:create_app',
        '--factory',
        '--host',
        '127.0.0.1',
        '--port',
        String(websitePort),
        '--no-access-log',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          WEBSITE_STATE_DIR: this.stateDir,
          WEBSITE_EXCHANGE_TOKEN_FILE: tokenFile,
          WEBSITE_EXCHANGE_URL: `http://127.0.0.1:${port}`,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    await healthy(`http://127.0.0.1:${websitePort}/health`, 'Website backend');
  }

  async stop() {
    const child = this.process;
    this.process = null;
    await terminate(child);
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

export const test = base.extend<{ exchange: Exchange; website: Website }>({
  exchange: async ({ browser }, use) => {
    const exchange = new Exchange();
    await exchange.start();
    await use(exchange);
    // Close participants first so they do not reconnect to a stopped exchange.
    for (const context of browser.contexts()) await context.close();
    await exchange.stop();
  },
  // Depends on the exchange so it starts after, and stops before, it.
  website: async ({ exchange }, use) => {
    void exchange;
    const website = new Website();
    await website.start();
    await use(website);
    await website.stop();
  },
});
export { expect };
