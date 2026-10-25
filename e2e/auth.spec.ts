import { expect, test } from '@playwright/test';

import { SEED_PASSWORD, login, logout, users } from './support';

test('wrong password shows the backend message inline', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Phone').fill(users.secretary.phone);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText(/invalid phone or password/i);
  await expect(page).toHaveURL(/\/login/);
});

test('signs in, survives a reload, and signs out', async ({ page }) => {
  await login(page, users.secretary);
  await expect(page.getByText(users.secretary.name).first()).toBeVisible();

  await page.reload(); // session restored from the stored token via /api/users/me
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(users.secretary.name).first()).toBeVisible();

  await logout(page);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fusers/);
});

test('returns to the requested page after signing in', async ({ page }) => {
  await page.goto('/structure');
  await expect(page).toHaveURL(/returnUrl=%2Fstructure/);
  await page.getByLabel('Phone').fill(users.secretary.phone);
  await page.getByLabel('Password', { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/structure$/);
});

test('an expired or invalid token sends the user back to login', async ({ page }) => {
  await login(page, users.secretary);
  await page.evaluate(() => localStorage.setItem('sm.token', 'not-a-real-token'));
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
});
