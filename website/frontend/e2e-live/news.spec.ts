import { api, expect, participant, test, tokens } from './fixtures.ts';

const publish = (baseURL: string, body: Record<string, unknown>) =>
  api(baseURL, 'POST', '/news', tokens.publisher, body);

test('signed-out participants see news live with an unread count and countdown', async ({
  browser,
  exchange,
  baseURL,
}) => {
  const base = baseURL ?? '';
  const backlog = await publish(base, { headline: 'Session open' });
  expect(backlog.status).toBe(201);

  const viewer = await participant(browser, null, 'overview');
  const { page } = viewer;
  const nav = page.locator('[data-nav="news"]');
  await expect(page.getByRole('banner')).toContainText('Not connected');
  await expect(nav.locator('#news-unread')).toHaveText('1');

  // Published while the screen is closed: the unread count rises without reload.
  const eventAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const started = Date.now();
  const announced = await publish(base, {
    headline: 'Reserves report due',
    body: 'Quarterly figures.',
    instrument_ids: ['QC-EUR'],
    event_at: eventAt,
  });
  expect(announced.status).toBe(201);
  await expect(nav.locator('#news-unread')).toHaveText('2', { timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);

  await nav.click();
  await expect(nav.locator('#news-unread')).toHaveCount(0);
  const items = page.locator('#news-list > li');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('Reserves report due');
  await expect(items.first()).toContainText('QC-EUR');
  await expect(items.first()).toContainText('Quarterly figures.');
  await expect(items.first().locator('[data-countdown]')).toHaveText(
    /^in 0\d:\d\d$/,
  );
  await expect(items.nth(1)).toContainText('Session open');

  // A new item appears at the top while the screen is open, within 2 s.
  const latest = Date.now();
  await publish(base, { headline: 'Breaking: large holder moves QC' });
  await expect(items.first()).toContainText('Breaking: large holder moves QC', {
    timeout: 2000,
  });
  expect(Date.now() - latest).toBeLessThan(2000);
  await expect(nav.locator('#news-unread')).toHaveCount(0);

  // Restart clears the feed: news is in memory only.
  await exchange.restart();
  await expect(page.locator('#news-empty')).toContainText('No news yet');
  expect(viewer.errors).toEqual([]);
});
