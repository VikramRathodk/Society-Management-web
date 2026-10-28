import { Page, expect, test } from '@playwright/test';

import { apiToken, login, users } from './support';

const description = `E2E complaint ${Date.now()}: kitchen tap leaking`;

function row(page: Page) {
  return page.locator('app-complaint-row', { hasText: description });
}

async function openComplaint(page: Page): Promise<void> {
  await page.goto('/complaints');
  await row(page).click();
  await expect(page.getByText(description)).toBeVisible();
}

async function move(page: Page, action: string, note?: string): Promise<void> {
  await page.getByRole('button', { name: action }).click();
  const dialog = page.getByRole('dialog');
  if (note) await dialog.getByLabel('Note (optional)').fill(note);
  await dialog.getByRole('button', { name: action }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe.serial('complaint lifecycle', () => {
  test.afterAll(async ({ request }) => {
    // The last test withdraws it; if a step failed earlier, reopen it so the author can withdraw.
    const committee = { Authorization: `Bearer ${await apiToken(request, users.committee)}` };
    const author = { Authorization: `Bearer ${await apiToken(request, users.resident1001)}` };
    const res = await request.get('/api/complaints?societyId=1&page=0&size=100', { headers: committee });
    const left = ((await res.json()) as { id: number; description: string; status: string }[]).filter(
      (c) => c.description === description,
    );
    for (const c of left) {
      if (c.status === 'RESOLVED') await request.post(`/api/complaints/${c.id}/reopen`, { headers: committee });
      await request.delete(`/api/complaints/${c.id}`, { headers: author });
    }
  });

  test('a resident raises a complaint for their flat', async ({ page }) => {
    await login(page, users.resident1001);
    await page.goto('/complaints/new');
    await expect(page.getByText('For flat Stark Wing-1001')).toBeVisible();
    await page.getByRole('button', { name: /Plumbing/ }).click();
    await page.getByLabel("What's wrong?").fill(description);
    await page.getByRole('button', { name: 'Raise complaint' }).click();

    await expect(page).toHaveURL(/\/complaints\/\d+$/);
    await expect(page.getByText(description)).toBeVisible();
    await expect(page.locator('app-page-header app-status-pill')).toHaveText('Open');
    await expect(page.locator('.step-title').first()).toHaveText('Raised by Wanda Maximoff');
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  });

  test("another flat's resident can't see it", async ({ page }) => {
    await login(page, users.residentPenthouse);
    await page.goto('/complaints');
    await expect(page.getByRole('heading', { name: 'Complaints' })).toBeVisible();
    await expect(row(page)).toHaveCount(0);
  });

  test('the committee works on it and resolves it with a note', async ({ page }) => {
    await login(page, users.committee);
    await openComplaint(page);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0); // author only
    await move(page, 'Start work', 'Plumber booked for tomorrow');
    await expect(page.locator('app-page-header app-status-pill')).toHaveText('In progress');
    await move(page, 'Mark resolved', 'Washer replaced');
    await expect(page.locator('app-page-header app-status-pill')).toHaveText('Resolved');
    await expect(page.locator('.step-title').first()).toHaveText('Resolved by Steve Rogers');
  });

  test('the resident sees the notes and can no longer edit it', async ({ page }) => {
    await login(page, users.resident1001);
    await openComplaint(page);
    await expect(page.getByText('Washer replaced')).toBeVisible();
    await expect(page.getByText('Plumber booked for tomorrow')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  });

  test('the committee reopens it, then the resident withdraws it', async ({ page }) => {
    await login(page, users.committee);
    await openComplaint(page);
    await move(page, 'Reopen', 'Still dripping');
    await expect(page.locator('.step-title').first()).toHaveText('Reopened by Steve Rogers');

    await page.getByRole('button', { name: 'Log out' }).click();
    await login(page, users.resident1001);
    await openComplaint(page);
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Withdraw' }).click();
    await expect(page).toHaveURL(/\/complaints$/);
    await expect(row(page)).toHaveCount(0);
  });
});
