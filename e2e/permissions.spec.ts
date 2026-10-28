import { expect, test } from '@playwright/test';

import { SeedUser, login, users } from './support';

const NAV = [
  'Dashboard',
  'Societies',
  'Structure',
  'Users',
  'Visitors',
  'Notices',
  'Complaints',
  'Roles',
];

/** What each seeded role should see in the side nav. */
const expectedNav: [string, SeedUser, string[]][] = [
  ['super admin', users.superAdmin, NAV],
  ['secretary', users.secretary, [
    'Dashboard',
    'Societies',
    'Structure',
    'Users',
    'Visitors',
    'Notices',
    'Complaints',
  ]],
  // GUARD has FLAT.DIRECTORY.VIEW so it can pick flats when logging visitors.
  ['guard', users.guard, ['Dashboard', 'Structure', 'Visitors', 'Notices']],
  ['resident', users.resident1001, ['Dashboard', 'Structure', 'Visitors', 'Notices', 'Complaints']],
];

for (const [role, user, visible] of expectedNav) {
  test(`${role} sees only the nav items their permissions allow`, async ({ page }) => {
    await login(page, user);
    const nav = page.getByRole('navigation').or(page.locator('mat-nav-list'));
    for (const item of NAV) {
      const link = nav.getByRole('link', { name: item, exact: true });
      if (visible.includes(item)) await expect(link).toBeVisible();
      else await expect(link).toHaveCount(0);
    }
  });
}

test('a resident typing a guarded URL lands on the forbidden page', async ({ page }) => {
  await login(page, users.residentPenthouse);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('super admin has a society switcher; secretary sees their society name', async ({ page }) => {
  await login(page, users.superAdmin);
  await expect(page.getByRole('combobox', { name: 'Society' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();

  await login(page, users.secretary);
  await expect(page.getByRole('combobox', { name: 'Society' })).toHaveCount(0);
  await expect(page.getByText('Avengers Tower').first()).toBeVisible();
});
