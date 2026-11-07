import { expect, test } from '@playwright/test';

test('account tabs support keyboard selection without losing their panels', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeAttached();
  const holdings = page.getByRole('tab', { name: 'Holdings' });
  const cash = page.getByRole('tab', { name: 'Cash', exact: true });
  await expect(holdings).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Quant Coin');
  await holdings.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cash).toBeFocused();
  await expect(cash).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Reserved in orders');
  await expect(page.getByRole('tabpanel')).not.toContainText('Quant Coin');
  await page.keyboard.press('ArrowLeft');
  await expect(holdings).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Quant Coin');
  expect(errors).toEqual([]);
});

test('shell fits the viewport and loads its own fonts', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4174/'))
      externalRequests.push(request.url());
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
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
  await expect(page.getByRole('link', { name: 'Instagram' })).toHaveAttribute(
    'href',
    'https://instagram.com/praguequantclub',
  );
  await expect(page.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute(
    'href',
    'https://linkedin.com/company/prague-quant-club',
  );
  expect(externalRequests).toEqual([]);
});
