import { expect, test } from '@playwright/test';

const views = ['overview', 'trade', 'leaderboard', 'account'] as const;
const names = {
  overview: 'Overview',
  trade: 'Trade QC',
  leaderboard: 'Leaderboard',
  account: 'API / Account',
};

test('all reviewed views render with local fonts and no runtime errors', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4174/'))
      external.push(request.url());
  });
  for (const view of views) {
    await page.goto(`/#${view}`);
    await expect(
      page.getByRole('heading', { name: names[view], exact: true, level: 1 }),
    ).toBeAttached();
    await expect(page.locator(`[data-view="${view}"]`)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${view}.png`),
      fullPage: true,
    });
  }
  for (const family of ['Inter', 'Space Grotesk', 'JetBrains Mono']) {
    expect(
      await page.evaluate(
        (name) =>
          [...document.fonts].some(
            (font) => font.family === name && font.status === 'loaded',
          ),
        family,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole('link', { name: 'Instagram', exact: true }),
  ).toHaveAttribute('href', 'https://instagram.com/praguequantclub');
  await expect(
    page.getByRole('link', { name: 'LinkedIn', exact: true }),
  ).toHaveAttribute('href', 'https://linkedin.com/company/prague-quant-club');
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('navigation supports keyboard, history, unknown routes, and API notes', async ({
  page,
}) => {
  await page.goto('/#trade');
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page).toHaveURL(/#trade$/);
  await page.getByRole('link', { name: 'Leaderboard', exact: true }).click();
  await expect(page).toHaveTitle('Leaderboard · PQC Trading');
  await page.goBack();
  await expect(page).toHaveTitle('Trade · PQC Trading');
  await page.goto('/#unknown');
  await expect(page).toHaveTitle('Overview · PQC Trading');
  const account = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'API / Account' });
  await account.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#account-title')).toBeFocused();
  await page.getByRole('link', { name: 'Read provisional API notes' }).click();
  await expect(page.locator('#api-docs')).toBeFocused();
  await page.reload();
  await expect(page.locator('#api-docs')).toBeFocused();
});

test('resting orders reserve funds, persist across navigation, and cancel once', async ({
  page,
}) => {
  await page.goto('/#trade');
  await page.getByRole('button', { name: 'Place limit buy' }).click();
  const order = page.locator('#orders-body tr').filter({ hasText: 'D-1042' });
  await expect(order).toContainText('Open');
  await expect(page.locator('#order-feedback')).toContainText(
    'Your order is open',
  );
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('[data-value="cash"]')).toContainText('69,850.00');
  await page.getByRole('link', { name: 'Trade', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel order D-1042' }).click();
  await expect(order).toContainText('Cancelled');
  await expect(order.getByRole('button')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cancel order D-1041' }),
  ).toBeFocused();
  await expect(page.locator('#order-feedback')).toContainText(
    'D-1042 cancelled',
  );
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('[data-value="cash"]')).toContainText('70,950.00');
});

test('crossing orders fill only displayed liquidity and cancel the remainder', async ({
  page,
}) => {
  await page.goto('/#trade');
  await page.getByLabel('Limit price', { exact: true }).fill('112.70');
  await page.getByRole('button', { name: 'Place limit buy' }).click();
  await expect(page.locator('#order-feedback')).toContainText(
    '6 QC filled within your limit. 4 QC remains open',
  );
  await expect(page.locator('#fills-body tr').first()).toContainText('112.60');
  await expect(page.locator('#fills-body tr').first()).toContainText('6');
  await expect(page.locator('#last-price')).toContainText('112.60');
  await page.getByRole('button', { name: 'Cancel order D-1042' }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('[data-value="holdings"]')).toContainText('486');
  await expect(page.locator('[data-value="cash"]')).toContainText('70,274.40');
});

test('invalid order fields get feedback and focus, and sells enforce holdings', async ({
  page,
}) => {
  await page.goto('/#trade');
  const price = page.getByLabel('Limit price', { exact: true });
  const quantity = page.getByLabel('Quantity', { exact: true });
  await price.fill('0');
  await page.getByRole('button', { name: 'Place limit buy' }).click();
  await expect(price).toBeFocused();
  await expect(price).toHaveAttribute('aria-invalid', 'true');
  await price.fill('110.00');
  await quantity.fill('1.5');
  await page.getByRole('button', { name: 'Place limit buy' }).click();
  await expect(quantity).toBeFocused();
  await expect(quantity).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('radio', { name: 'Sell QC' }).check();
  await quantity.fill('481');
  await page.getByRole('button', { name: 'Place limit sell' }).click();
  await expect(page.locator('#order-feedback')).toContainText(
    'Not enough available QC',
  );
  await expect(page.locator('#orders-body tr')).toHaveCount(1);
  await price.fill('112.30');
  await quantity.fill('12');
  await page.getByRole('button', { name: 'Place limit sell' }).click();
  await expect(page.locator('#order-feedback')).toContainText(
    '8 QC filled within your limit. 4 QC remains open',
  );
});

test('all four ranking periods remain selected after leaving the view', async ({
  page,
}) => {
  await page.goto('/#leaderboard');
  for (const [label, rank] of [
    ['Continuous', '#12'],
    ['Weekly', '#7'],
    ['Monthly', '#18'],
    ['Yearly', '#9'],
  ] as const) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#leader-rank')).toContainText(rank ?? '');
  }
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('link', { name: 'Leaderboard', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Yearly', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('dummy credentials copy, revoke, and recreate with useful focus', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#account');
  const key = page.getByLabel('Sample key', { exact: true });
  const original = await key.inputValue();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Sample key copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    original,
  );
  await page.getByRole('button', { name: 'Revoke sample key' }).click();
  const create = page.getByRole('button', { name: 'Create sample key' });
  await expect(create).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Copy', exact: true }),
  ).toBeDisabled();
  await create.click();
  await expect(
    page.getByRole('button', { name: 'Copy', exact: true }),
  ).toBeFocused();
  await expect(key).not.toHaveValue(original);
  await expect(key).toHaveValue(/^pqc_demo_only_/);
});

test('clipboard failure selects the dummy key for manual copying', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('Denied')) },
    }),
  );
  await page.goto('/#account');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Clipboard unavailable');
  await expect(page.getByLabel('Sample key', { exact: true })).toBeFocused();
  expect(
    await page
      .getByLabel('Sample key', { exact: true })
      .evaluate(
        (input: HTMLInputElement) =>
          input.selectionEnd === input.value.length &&
          input.selectionStart === 0,
      ),
  ).toBe(true);
});

test('missing observations remain unavailable after an unfilled order', async ({
  page,
}) => {
  await page.goto('/?scenario=no-trades#overview');
  await expect(page.getByText('No performance history yet')).toBeVisible();
  await page.getByRole('link', { name: 'Trade', exact: true }).click();
  await expect(page.locator('#last-price')).toContainText('No trades yet');
  await expect(
    page
      .locator('#candlestick-chart')
      .getByText('No executions yet', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Place limit buy' }).click();
  await expect(page.locator('#orders-body')).toContainText('Open');
  await expect(page.locator('#fills-body')).toContainText('No fills yet');
  await expect(page.locator('#last-price')).toContainText('No trades yet');
  await page.getByRole('link', { name: 'Leaderboard', exact: true }).click();
  await page.getByRole('button', { name: 'Weekly', exact: true }).click();
  await expect(page.locator('#leader-rank')).toHaveText('—');
  await expect(
    page.getByRole('table', {
      name: 'Participant ranks and summary returns only',
    }),
  ).toContainText('Awaiting the first ranking snapshot');
});

test('all content remains available without page overflow at intermediate widths', async ({
  page,
}) => {
  for (const width of [320, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of views) {
      await page.goto(`/#${view}`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${view} at ${width}`,
      ).toBe(true);
    }
  }
});
