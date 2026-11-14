import { api, expect, order, participant, test, tokens } from './fixtures.ts';

// The backend samples every 10 s and the browser polls every 15 s.
const RANKING_WAIT = { timeout: 45_000 };

test('live rankings: public leaderboard signed out, own standing signed in', async ({
  browser,
  website,
  baseURL,
}) => {
  void website;
  test.setTimeout(150_000);
  const base = baseURL ?? '';
  const visitor = await participant(browser, null, 'leaderboard');
  const table = visitor.page.getByRole('table', {
    name: 'Participant ranks and summary returns only',
  });
  // Before any trade there is no mark, so nothing is valued or ranked.
  await expect(table).toContainText('Rankings are not calculated yet.', RANKING_WAIT);

  // One trade at 100 gives a mark; both accounts are worth 1,000 EUR.
  await api(base, 'POST', '/orders', tokens.bob, order('sell', '100.00', '2'));
  await api(base, 'POST', '/orders', tokens.alice, order('buy', '100.00', '2'));
  await expect(visitor.page.locator('[data-view="leaderboard"]')).toContainText(
    '2 participants',
    RANKING_WAIT,
  );

  // A resting book with a 115 mid lifts bob (8 QC) above alice (2 QC).
  await api(base, 'POST', '/orders', tokens.alice, order('buy', '110.00', '1'));
  await api(base, 'POST', '/orders', tokens.bob, order('sell', '120.00', '1'));
  await expect(table.locator('tbody tr').first()).toContainText('bob', RANKING_WAIT);
  await expect(table.locator('tbody tr').nth(1)).toContainText('alice');
  await expect(table.locator('tbody tr').first()).toContainText('+');
  // Public standings carry rank, name and return only.
  await expect(table).not.toContainText('EUR');
  await expect(visitor.page.locator('#leader-rank')).toHaveText('—');

  const alice = await participant(browser, tokens.alice, 'leaderboard');
  await expect(alice.page.locator('#leader-rank')).toContainText('#2', RANKING_WAIT);
  await expect(alice.page.locator('#leader-rank')).toContainText('/ 2');
  await expect(alice.page.locator('#leader-return')).toContainText('+');
  await expect(alice.page.getByRole('complementary')).toContainText('YOU');

  await alice.page.goto('/#overview');
  await expect(alice.page.locator('[data-value="total"]')).toContainText(/\d/);
  await expect(alice.page.locator('[data-value="total"]')).toContainText('EUR');
  await expect(alice.page.locator('[data-value="profit-percent"]')).toContainText(
    'since joining',
  );
  await expect(
    alice.page.locator('[data-view="overview"]').getByText('Your current rank'),
  ).toBeVisible();
  await expect(alice.page.locator('[data-view="overview"]')).toContainText('/ 2');
  // One value point so far; the series fills in every 10 minutes.
  await expect(alice.page.locator('#performance-chart')).toContainText(
    'No performance history yet',
  );
  expect([...visitor.errors, ...alice.errors]).toEqual([]);
});
