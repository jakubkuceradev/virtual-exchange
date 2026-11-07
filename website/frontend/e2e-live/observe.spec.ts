import { api, expect, order, participant, test, tokens } from './fixtures.ts';

test('two participants see their own funds and a shared live book', async ({
  browser,
  exchange,
  baseURL,
}) => {
  void exchange;
  const alice = await participant(browser, tokens.alice, 'overview');
  const bob = await participant(browser, tokens.bob, 'overview');
  await expect(alice.page.locator('[data-value="cash"]')).toContainText('1,000.00');
  await expect(alice.page.locator('[data-value="holdings"]')).toContainText('0');
  await expect(bob.page.locator('[data-value="cash"]')).toContainText('0.00');
  await expect(bob.page.locator('[data-value="holdings"]')).toContainText('10');
  await expect(alice.page.getByRole('banner')).toContainText('alice');
  await expect(bob.page.getByRole('banner')).toContainText('bob');

  for (const { page } of [alice, bob]) await page.goto('/#trade');
  const placed = await api(baseURL ?? '', 'POST', '/orders', tokens.bob, order('sell', '100.00', '2'));
  expect(placed.status).toBe(201);
  // Both books update from the stream, without reloading.
  for (const { page } of [alice, bob])
    await expect(page.locator('#asks tr').first().locator('td')).toHaveText([
      '100.00',
      '2',
      '2',
    ]);
  await expect(bob.page.locator('#orders-body')).toContainText('Open');
  await expect(alice.page.locator('#orders-body')).toContainText('No orders yet');
  expect([...alice.errors, ...bob.errors]).toEqual([]);
});

test('credential states never show another account or allow commands', async ({
  browser,
  exchange,
  baseURL,
}) => {
  void exchange;
  await api(baseURL ?? '', 'POST', '/orders', tokens.alice, order('buy', '90.00', '1'));
  const reader = await participant(browser, tokens.aliceRead);
  await expect(reader.page.locator('#orders-body')).toContainText('Open');
  await expect(reader.page.locator('#submit-order')).toBeDisabled();
  await expect(reader.page.locator('#ticket-blocked')).toContainText('read-only');
  await expect(reader.page.getByRole('button', { name: /Cancel order/ })).toBeDisabled();

  const tradeOnly = await participant(browser, tokens.aliceTrade, 'account');
  await expect(tradeOnly.page.locator('#connection-status')).toContainText('no read access');
  await tradeOnly.page.goto('/#trade');
  await expect(tradeOnly.page.locator('#orders-body')).toContainText('cannot read');
  await expect(tradeOnly.page.locator('#submit-order')).toBeDisabled();

  const unfunded = await participant(browser, tokens.carol, 'account');
  await expect(unfunded.page.locator('#connection-status')).toContainText('no trading allocation');

  const invalid = await participant(browser, 'not-a-real-token', 'account');
  await expect(invalid.page.locator('#connection-status')).toContainText('not accepted');
  await expect(invalid.page.getByRole('banner')).toContainText('Not connected');
});

test('before the first trade, live views show only actual data', async ({
  browser,
  exchange,
}, info) => {
  void exchange;
  const alice = await participant(browser, tokens.alice, 'trade');
  const { page } = alice;
  await expect(page.locator('#last-price')).toContainText('No trades yet');
  await expect(page.locator('#candlestick-chart')).toContainText('No executions yet');
  await expect(page.locator('#asks')).toContainText('No resting orders');
  await page.goto('/#overview');
  await expect(page.locator('[data-value="total"]')).toContainText('—');
  await expect(page.locator('#performance-chart')).toContainText('unavailable');
  await page.goto('/#leaderboard');
  await expect(page.locator('#leader-rank')).toHaveText('—');
  for (const [name, width, height] of [
    ['desktop', 1440, 1000],
    ['mobile', 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const view of ['overview', 'trade', 'account']) {
      await page.goto(`/#${view}`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`${name}-${view}.png`), fullPage: true });
    }
  }
  expect(alice.errors).toEqual([]);
});
