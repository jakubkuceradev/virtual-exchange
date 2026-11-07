import type { Page } from '@playwright/test';
import {
  api,
  connect,
  expect,
  order,
  participant,
  test,
  tokens,
} from './fixtures.ts';

async function place(page: Page, side: 'buy' | 'sell', price: string, quantity: string) {
  await page.getByRole('radio', { name: side === 'buy' ? 'Buy QC' : 'Sell QC' }).check();
  await page.getByLabel('Limit price', { exact: true }).fill(price);
  await page.getByLabel('Quantity', { exact: true }).fill(quantity);
  await page.getByRole('button', { name: `Place limit ${side}` }).click();
  await expect(page.locator('#submit-order')).toBeEnabled();
}

async function balances(page: Page) {
  await page.goto('/#overview');
  const cash = await page.locator('[data-value="cash"]').innerText();
  const reserved = await page.locator('[data-value="reserved"]').innerText();
  const holdings = await page.locator('[data-value="holdings"]').innerText();
  await page.goto('/#trade');
  return { cash, reserved, holdings };
}

test('Bob rests a sell, Alice sees it live and buys it: one execution for both', async ({
  browser,
  exchange,
}) => {
  void exchange;
  const alice = await participant(browser, tokens.alice);
  const bob = await participant(browser, tokens.bob);
  await place(bob.page, 'sell', '100', '2');
  await expect(bob.page.locator('#order-feedback')).toContainText('accepted');
  await expect(alice.page.locator('#asks tr').first().locator('td')).toHaveText([
    '100.00',
    '2',
    '2',
  ]);
  await place(alice.page, 'buy', '100', '2');
  for (const { page } of [alice, bob]) {
    await expect(page.locator('#last-price')).toContainText('100.00');
    await expect(page.locator('#fills-body tr')).toHaveCount(1);
    await expect(page.locator('#fills-body tr').first()).toContainText('100.00');
    await expect(page.locator('#orders-body')).toContainText('Filled');
    await expect(page.locator('#asks')).toContainText('No resting orders');
    await expect(page.locator('#bids')).toContainText('No resting orders');
    await expect(page.locator('#candlestick-chart svg')).toBeVisible();
  }
  await expect
    .poll(() => balances(alice.page))
    .toEqual({
      cash: '800.00 EUR',
      reserved: '0.00 EUR reserved in orders',
      holdings: '2 QC',
    });
  await expect
    .poll(() => balances(bob.page))
    .toEqual({
      cash: '200.00 EUR',
      reserved: '0.00 EUR reserved in orders',
      holdings: '8 QC',
    });
  expect([...alice.errors, ...bob.errors]).toEqual([]);
});

test('a multi-price partial fill executes at actual prices and the remainder cancels', async ({
  browser,
  exchange,
}) => {
  void exchange;
  const alice = await participant(browser, tokens.alice);
  const bob = await participant(browser, tokens.bob);
  await place(bob.page, 'sell', '99', '1');
  await place(bob.page, 'sell', '100', '1');
  await expect(alice.page.locator('#asks tr')).toHaveCount(2);
  await place(alice.page, 'buy', '100', '3');
  const fills = alice.page.locator('#fills-body tr');
  await expect(fills).toHaveCount(2);
  await expect(fills.nth(0)).toContainText('100.00');
  await expect(fills.nth(1)).toContainText('99.00');
  const remainder = alice.page.locator('#orders-body tr').first();
  await expect(remainder).toContainText('Partly filled');
  await expect(remainder).toContainText('1 / 3');
  await expect(alice.page.locator('#bids tr').first().locator('td')).toHaveText([
    '100.00',
    '1',
    '1',
  ]);
  await expect
    .poll(() => balances(alice.page))
    .toMatchObject({ cash: '701.00 EUR', reserved: '100.00 EUR reserved in orders' });
  await alice.page.getByRole('button', { name: /Cancel order/ }).click();
  await expect(alice.page.locator('#order-feedback')).toContainText('cancelled');
  await expect(remainder).toContainText('Cancelled');
  await expect(bob.page.locator('#bids')).toContainText('No resting orders');
  await expect
    .poll(() => balances(alice.page))
    .toEqual({
      cash: '801.00 EUR',
      reserved: '0.00 EUR reserved in orders',
      holdings: '2 QC',
    });
  await expect.poll(() => balances(bob.page)).toMatchObject({ cash: '199.00 EUR' });
});

test('insufficient funds is rejected without fabricating a reservation', async ({
  browser,
  exchange,
}) => {
  void exchange;
  const alice = await participant(browser, tokens.alice);
  await place(alice.page, 'buy', '100', '20');
  await expect(alice.page.locator('#order-feedback')).toContainText(
    'Not enough available funds',
  );
  await expect(alice.page.getByLabel('Quantity', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(alice.page.locator('#orders-body')).toContainText('No orders yet');
  expect(await balances(alice.page)).toMatchObject({ cash: '1,000.00 EUR' });
});

test('switching accounts replaces private data without mixing grants', async ({
  browser,
  exchange,
  baseURL,
}) => {
  void exchange;
  await api(baseURL ?? '', 'POST', '/orders', tokens.alice, order('buy', '90.00', '1'));
  const viewer = await participant(browser, tokens.alice);
  await expect(viewer.page.locator('#orders-body')).toContainText('90.00');
  await connect(viewer.page, tokens.bob);
  await viewer.page.goto('/#trade');
  await expect(viewer.page.getByRole('banner')).toContainText('bob');
  await expect(viewer.page.locator('#orders-body')).toContainText('No orders yet');
  await connect(viewer.page, tokens.aliceRead);
  await viewer.page.goto('/#trade');
  await expect(viewer.page.locator('#orders-body')).toContainText('90.00');
  await expect(viewer.page.locator('#submit-order')).toBeDisabled();
});

test('a cancel that loses the race to an execution shows the fill', async ({
  browser,
  exchange,
  baseURL,
}) => {
  void exchange;
  const alice = await participant(browser, tokens.alice);
  await place(alice.page, 'buy', '100', '1');
  await expect(alice.page.locator('#orders-body')).toContainText('Open');
  await alice.page.route('**/exchange/orders/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      // Bob fills the order while the cancellation is in flight.
      await api(baseURL ?? '', 'POST', '/orders', tokens.bob, order('sell', '100.00', '1'));
    }
    await route.continue();
  });
  await alice.page.getByRole('button', { name: /Cancel order/ }).click();
  await expect(alice.page.locator('#order-feedback')).toContainText(
    'finished before the cancellation',
  );
  await expect(alice.page.locator('#orders-body')).toContainText('Filled');
  await expect(alice.page.locator('#fills-body tr')).toHaveCount(1);
});

test('a lost submit response produces exactly one order and reservation', async ({
  browser,
  exchange,
  baseURL,
}) => {
  void exchange;
  const alice = await participant(browser, tokens.alice);
  let posts = 0;
  await alice.page.route('**/exchange/orders', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    await route.fetch(); // The exchange accepts it...
    await route.abort('failed'); // ...but the browser never sees the reply.
  });
  await alice.page.getByLabel('Limit price', { exact: true }).fill('100');
  await alice.page.getByLabel('Quantity', { exact: true }).fill('2');
  await alice.page.getByRole('button', { name: 'Place limit buy' }).click();
  await expect(alice.page.locator('#order-feedback')).toContainText(
    'received your order',
  );
  await expect(alice.page.locator('#orders-body tr')).toHaveCount(1);
  await expect(alice.page.locator('#submit-order')).toBeEnabled();
  const listed = await api(baseURL ?? '', 'GET', '/orders', tokens.alice);
  expect(listed.body.data).toHaveLength(1);
  const held = await api(baseURL ?? '', 'GET', '/balances', tokens.alice);
  expect(held.body.data).toContainEqual({
    asset_id: 'EUR',
    available: '800.000',
    reserved: '200.000',
  });
  expect(posts).toBe(1);
});
