import { expect, test } from '@playwright/test';

import { SEED_PASSWORD, login, logout, users } from './support';

const NEW_PASSWORD = 'Changed@456';

// Puts the seed password back even if the test fails halfway, so other specs can still log in.
test.afterEach(async ({ request }) => {
  const res = await request.post('/api/auth/login', {
    data: { phone: users.resident1001.phone, password: NEW_PASSWORD },
  });
  if (!res.ok()) return; // never changed
  const { token } = await res.json();
  const restore = await request.post('/api/users/me/password', {
    headers: { Authorization: `Bearer ${token}` },
    data: { currentPassword: NEW_PASSWORD, newPassword: SEED_PASSWORD },
  });
  expect(restore.ok()).toBeTruthy();
});

test('resident changes their password from the profile page', async ({ page }) => {
  await login(page, users.resident1001);
  await page.goto('/profile');

  const current = page.getByLabel('Current password');
  const next = page.getByLabel('New password', { exact: true });
  const confirm = page.getByLabel('Confirm new password');
  const submit = page.getByRole('button', { name: 'Change password' });

  // Mismatch is caught in the browser.
  await current.fill(SEED_PASSWORD);
  await next.fill(NEW_PASSWORD);
  await confirm.fill('Something@else');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText("Passwords don't match");

  // A wrong current password comes back from the backend and is shown inline.
  await current.fill('not-my-password');
  await confirm.fill(NEW_PASSWORD);
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Current password is incorrect');

  await current.fill(SEED_PASSWORD);
  await submit.click();
  await expect(page.getByText('Password changed')).toBeVisible();
  await expect(current).toHaveValue('');

  // Only the new password works now.
  await logout(page);
  await page.getByLabel('Phone').fill(users.resident1001.phone);
  await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});
