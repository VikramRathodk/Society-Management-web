import { Page, expect, test } from '@playwright/test';

import { apiToken, login, users } from './support';

const title = `E2E Notice ${Date.now()}`;

function notice(page: Page) {
  return page.locator('article.notice', { hasText: title });
}

test.describe.serial('notice board', () => {
  test.afterAll(async ({ request }) => {
    // Remove what this run posted, in case a step failed before the delete test.
    const token = await apiToken(request, users.secretary);
    const headers = { Authorization: `Bearer ${token}` };
    const res = await request.get('/api/societies/1/notices?page=0&size=100', { headers });
    const created = ((await res.json()) as { id: number; title: string }[]).filter((n) =>
      n.title.startsWith(title),
    );
    for (const n of created) await request.delete(`/api/notices/${n.id}`, { headers });
  });

  test('secretary posts a notice', async ({ page }) => {
    await login(page, users.secretary);
    await page.goto('/notices');
    await page.getByRole('button', { name: 'Post notice' }).click();
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Details (optional)').fill('Water supply off\n10am to 2pm');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(notice(page)).toContainText('Water supply off');
    await expect(notice(page)).toContainText('Nick Fury');
  });

  test('a resident reads it on the board and the dashboard, without edit actions', async ({
    page,
  }) => {
    await login(page, users.resident1001);
    await expect(page.getByText(title)).toBeVisible(); // dashboard "Notice board" panel
    await page.goto('/notices');
    await expect(notice(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post notice' })).toHaveCount(0);
    await expect(notice(page).getByRole('button', { name: /Actions for/ })).toHaveCount(0);
  });

  test("a committee member can't change the secretary's notice", async ({ page }) => {
    await login(page, users.committee);
    await page.goto('/notices');
    await expect(notice(page)).toBeVisible();
    await expect(notice(page).getByRole('button', { name: /Actions for/ })).toHaveCount(0);
  });

  test('secretary edits then deletes it', async ({ page }) => {
    await login(page, users.secretary);
    await page.goto('/notices');
    await notice(page)
      .getByRole('button', { name: /Actions for/ })
      .click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill(`${title} (moved to Monday)`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(notice(page)).toContainText('(moved to Monday)');
    await expect(notice(page)).toContainText('edited');

    await notice(page)
      .getByRole('button', { name: /Actions for/ })
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(notice(page)).toHaveCount(0);
  });
});
