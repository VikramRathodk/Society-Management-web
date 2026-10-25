import { expect, test } from '@playwright/test';

import { login, users } from './support';

/** Read-only checks that each management screen loads real data from the seed. */

test('structure shows the seeded wing and its flats', async ({ page }) => {
  await login(page, users.secretary);
  await page.goto('/structure');
  await page.getByText('Stark Wing').click();
  for (const flat of ['101', '1001', 'Penthouse']) {
    await expect(page.locator('.flat-tile', { hasText: flat }).first()).toBeVisible();
  }
});

test('users directory searches by name', async ({ page }) => {
  await login(page, users.secretary);
  await page.goto('/users');
  await page.getByLabel('Search by name or phone').fill('wanda');
  await expect(page.getByRole('link', { name: users.resident1001.name })).toBeVisible();
  await expect(page.getByRole('link', { name: users.residentPenthouse.name })).toHaveCount(0);

  await page.getByRole('link', { name: users.resident1001.name }).click();
  await expect(page.getByRole('heading', { name: users.resident1001.name })).toBeVisible();
  await expect(page.getByText(/Stark Wing · 1001/)).toBeVisible();
});

test('role page shows own and inherited permissions', async ({ page }) => {
  await login(page, users.superAdmin);
  await page.goto('/roles/COMMITTEE');
  await expect(page.getByRole('heading', { name: 'Committee Member' })).toBeVisible();
  // COMMITTEE inherits RESIDENT, so a resident permission is ticked but locked.
  const inherited = page.getByRole('checkbox', { name: 'COMPLAINT.TICKET.CREATE' });
  await expect(inherited).toBeChecked();
  await expect(inherited).toBeDisabled();
});
