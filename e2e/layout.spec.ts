import { expect, test } from '@playwright/test';

import { login, users } from './support';

/**
 * Runs on desktop and phone. Fails if a page scrolls sideways, and saves a full-page screenshot of
 * each screen to test-results/screens for a visual check.
 */
const pages: [string, string, keyof typeof users][] = [
  ['dashboard', '/dashboard', 'secretary'],
  ['societies', '/societies', 'superAdmin'],
  ['structure', '/structure', 'secretary'],
  ['users', '/users', 'secretary'],
  ['user-new', '/users/new', 'secretary'],
  ['visitors', '/visitors', 'secretary'],
  ['visitor-new', '/visitors/new', 'guard'],
  ['roles', '/roles', 'superAdmin'],
  ['role-detail', '/roles/SECRETARY', 'superAdmin'],
  ['profile', '/profile', 'resident1001'],
];

test('login page fits the screen', async ({ page }, info) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-login.png` });
});

for (const [name, url, who] of pages) {
  test(`${name} fits the screen`, async ({ page }, info) => {
    await login(page, users[who]);
    await page.goto(url);
    await expect(page.locator('mat-progress-bar')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('h1').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: `test-results/screens/${info.project.name}-${name}.png`,
      fullPage: true,
    });
  });
}

test('on a phone the nav opens from the menu button', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone only');
  await login(page, users.secretary);
  const usersLink = page.getByRole('link', { name: 'Users', exact: true });
  await expect(usersLink).not.toBeInViewport();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await usersLink.click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(usersLink).not.toBeInViewport(); // closes after navigating
});

async function expectNoHorizontalScroll(page: import('@playwright/test').Page): Promise<void> {
  // Wide tables scroll inside their own container; the page itself must not.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(1);
}
