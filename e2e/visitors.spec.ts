import { Page, expect, test } from '@playwright/test';

import { apiToken, choose, login, logout, users } from './support';

const visitorName = `E2E Visitor ${Date.now()}`;

function card(page: Page) {
  return page.locator('app-visitor-row', { hasText: visitorName });
}

test.describe.serial('visitor lifecycle', () => {
  test.afterAll(async ({ request }) => {
    // Remove the entry this run created so the gate log doesn't fill up with test data.
    const token = await apiToken(request, users.secretary);
    const headers = { Authorization: `Bearer ${token}` };
    const res = await request.get('/api/visitors?societyId=1&page=0&size=100', { headers });
    const created = ((await res.json()) as { id: number; visitorName: string }[]).filter(
      (v) => v.visitorName === visitorName,
    );
    for (const v of created) await request.delete(`/api/visitors/${v.id}`, { headers });
  });

  // Needs FLAT.DIRECTORY.VIEW on the GUARD role, to pick the flat.
  test('guard logs a visitor with a photo', async ({ page }) => {
    await login(page, users.guard);
    await page.goto('/visitors/new');
    await choose(page, 'Wing', 'Stark Wing');
    await choose(page, 'Flat', '1001');
    await page.getByLabel('Visitor name').fill(visitorName);
    await page.getByLabel('Purpose (optional)').fill('Delivery');
    // Relative to the project root, where Playwright runs.
    await page.locator('input[type=file]').setInputFiles('e2e/fixtures/visitor.png');
    await expect(page.getByAltText('Visitor photo preview')).toBeVisible();
    await page.getByRole('button', { name: 'Log visitor' }).click();

    await expect(page).toHaveURL(/\/visitors$/);
    await expect(card(page)).toContainText('Pending');
    // The photo is fetched with the auth header and shown as a thumbnail.
    await expect(card(page).locator('app-visitor-avatar img')).toBeVisible();
    // The guard can't decide on the flat's behalf.
    await expect(card(page).getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test("another flat's resident can't see it", async ({ page }) => {
    await login(page, users.residentPenthouse);
    await page.goto('/visitors');
    await expect(page.getByRole('heading', { name: 'Visitors' })).toBeVisible();
    await expect(card(page)).toHaveCount(0);
  });

  test('committee member (not a resident of 1001) gets no approve buttons', async ({ page }) => {
    await login(page, users.committee);
    await page.goto('/visitors');
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test("the flat's resident approves", async ({ page }) => {
    await login(page, users.resident1001);
    await page.goto('/visitors');
    await card(page).getByRole('button', { name: 'Approve' }).click();
    await expect(card(page)).toContainText('Approved');
    await expect(card(page)).not.toContainText('Override');
  });

  test('guard marks the visitor in and out', async ({ page }) => {
    await login(page, users.guard);
    await page.goto('/visitors');
    await card(page).getByRole('button', { name: 'Mark entered' }).click();
    await expect(card(page)).toContainText('Inside');
    await card(page).getByRole('button', { name: 'Mark exited' }).click();
    await expect(card(page)).toContainText('Exited');

    // The status filter narrows the list.
    await page.getByRole('option', { name: 'Pending' }).click();
    await expect(card(page)).toHaveCount(0);
    await page.getByRole('option', { name: 'Exited' }).click();
    await expect(card(page)).toBeVisible();
    await logout(page);
  });
});
