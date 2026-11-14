import type { Page, WebSocketRoute } from '@playwright/test';
import { api, expect, order, participant, test, tokens } from './fixtures.ts';

/** Route a page's exchange WebSockets so a test can drop and block them. */
async function controllable(page: Page) {
  const open = new Set<WebSocketRoute>();
  let blocked = false;
  await page.routeWebSocket(/\/exchange\/ws$/, (socket) => {
    if (blocked) {
      socket.close({ code: 1011, reason: 'test outage' });
      return;
    }
    socket.connectToServer();
    open.add(socket);
  });
  return {
    async drop() {
      blocked = true;
      for (const socket of open) await socket.close({ code: 1011, reason: 'test outage' });
      open.clear();
    },
    restore() {
      blocked = false;
    },
  };
}

async function overview(page: Page) {
  await page.goto('/#overview');
  const result = {
    cash: await page.locator('[data-value="cash"]').innerText(),
    holdings: await page.locator('[data-value="holdings"]').innerText(),
  };
  await page.goto('/#trade');
  return result;
}

test('reconnecting while others trade restores book, orders, fills, chart and balances', async ({
  browser,
  exchange,
  baseURL,
}) => {
  void exchange;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const network = await controllable(page);
  await page.goto('/#account');
  await page.getByLabel('API token').fill(tokens.alice);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.goto('/#trade');
  const own = await api(baseURL ?? '', 'POST', '/orders', tokens.alice, order('buy', '99.00', '1'));
  expect(own.status).toBe(201);
  await expect(page.locator('#orders-body')).toContainText('Open');

  await network.drop();
  await expect(page.getByRole('status').first()).toContainText('Reconnecting');
  await expect(page.locator('#submit-order')).toBeDisabled();
  // While Alice is disconnected, Bob fills her order and rests more liquidity.
  for (const [price, quantity] of [
    ['99.00', '1'],
    ['100.00', '1'],
    ['101.00', '2'],
  ])
    expect(
      (await api(baseURL ?? '', 'POST', '/orders', tokens.bob, order('sell', price, quantity)))
        .status,
    ).toBe(201);
  network.restore();

  await expect(page.locator('#orders-body')).toContainText('Filled');
  await expect(page.locator('#fills-body tr')).toHaveCount(1);
  await expect(page.locator('#fills-body tr').first()).toContainText('99.00');
  await expect(page.locator('#asks tr')).toHaveCount(2);
  await expect(page.locator('#asks tr').last().locator('td')).toHaveText(['100.00', '1', '1']);
  await expect(page.locator('#last-price')).toContainText('99.00');
  await expect(page.locator('#candlestick-chart svg')).toBeVisible();
  await expect(page.locator('#submit-order')).toBeEnabled();
  await expect(page.getByText('Reconnecting')).toHaveCount(0);
  await expect.poll(() => overview(page)).toEqual({ cash: '901.00 EUR', holdings: '1 QC' });
});

test('an exchange restart restores committed state, keeps the credential, and replays nothing', async ({
  browser,
  exchange,
  baseURL,
}) => {
  const alice = await participant(browser, tokens.alice);
  const bob = await participant(browser, tokens.bob);
  const { page } = alice;
  await api(baseURL ?? '', 'POST', '/orders', tokens.bob, order('sell', '100.00', '2'));
  await page.getByLabel('Limit price', { exact: true }).fill('100');
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Place limit buy' }).click();
  await expect(page.locator('#fills-body tr')).toHaveCount(1);
  await expect(page.locator('#last-price')).toContainText('100.00');

  await exchange.restart();

  await expect(page.getByRole('status').first()).toContainText('restarted', {
    timeout: 20_000,
  });
  // The persistent exchange restores committed state; nothing is replayed.
  await expect(page.locator('#last-price')).toContainText('100.00');
  await expect(page.locator('#fills-body tr')).toHaveCount(1);
  await expect(page.locator('#asks')).toContainText('100.00');
  await expect(page.getByRole('banner')).toContainText('alice');
  await expect.poll(() => overview(page)).toEqual({ cash: '900.00 EUR', holdings: '1 QC' });
  await expect.poll(() => overview(bob.page)).toEqual({ cash: '100.00 EUR', holdings: '9 QC' });
  const orders = await api(baseURL ?? '', 'GET', '/orders', tokens.alice);
  expect(orders.body.data).toHaveLength(1);
  // The unchanged credential keeps working on the new process.
  await page.getByLabel('Limit price', { exact: true }).fill('50');
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Place limit buy' }).click();
  await expect(page.locator('#orders-body')).toContainText('Open');
});
