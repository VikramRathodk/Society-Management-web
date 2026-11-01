import { APIRequestContext, Page, expect, test } from '@playwright/test';

import { apiToken, login, users } from './support';

/**
 * Maintenance end to end on the seeded society: the secretary sets up a charge, issues a cycle and
 * records a payment; the resident sees their dues and receipt; then the payment is voided and the
 * cycle cancelled. Everything this creates is voided / cancelled / deleted again in afterAll.
 */
const charge = `E2E maintenance ${Date.now()}`;
const note = `E2E payment ${Date.now()}`;
const FLAT = 'Stark Wing-1001';

async function auth(request: APIRequestContext, user = users.secretary) {
  return { Authorization: `Bearer ${await apiToken(request, user)}` };
}

async function confirm(page: Page, button: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: button }).click();
  await expect(dialog).toHaveCount(0);
}

async function giveReason(page: Page, button: string, reason: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill(reason);
  await confirm(page, button);
}

test.describe.serial('maintenance billing and payments', () => {
  let cycleUrl = '';
  let receiptUrl = '';

  test.afterAll(async ({ request }) => {
    const headers = await auth(request);
    const payments = (await (
      await request.get('/api/maintenance/payments?societyId=1&size=100', { headers })
    ).json()) as { id: number; note: string | null; status: string }[];
    for (const p of payments.filter((p) => p.note === note && p.status === 'RECORDED'))
      await request.post(`/api/maintenance/payments/${p.id}/void`, {
        headers,
        data: { reason: 'E2E cleanup' },
      });
    const cycleId = cycleUrl.match(/\/cycles\/(\d+)/)?.[1];
    if (cycleId)
      await request.post(`/api/maintenance/cycles/${cycleId}/cancel`, {
        headers,
        data: { reason: 'E2E cleanup' },
      });
    const heads = (await (
      await request.get('/api/societies/1/maintenance/charge-heads', { headers })
    ).json()) as { id: number; name: string }[];
    for (const h of heads.filter((h) => h.name === charge))
      await request.delete(`/api/maintenance/charge-heads/${h.id}`, { headers });
  });

  test('the secretary adds a charge', async ({ page }) => {
    await login(page, users.secretary);
    await page.goto('/maintenance/settings');
    await page.getByRole('button', { name: 'Add charge' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(charge);
    await dialog.getByLabel('Amount per flat').fill('2500');
    await confirm(page, 'Save');
    await expect(page.getByText(charge)).toBeVisible();
    await expect(page.getByText('₹2,500.00 per flat').first()).toBeVisible();
  });

  test('previews and issues a billing cycle', async ({ page }) => {
    await login(page, users.secretary);
    await page.goto('/maintenance/cycles/new');
    await expect(page.getByLabel('From')).not.toHaveValue('');
    await page.getByRole('button', { name: 'Preview bills' }).click();
    const issue = page.getByRole('button', { name: /^Issue \d+ bills$/ });
    await expect(issue).toBeEnabled();
    await expect(page.getByRole('cell', { name: FLAT })).toBeVisible();
    await issue.click();
    await confirm(page, 'Issue bills');

    await expect(page).toHaveURL(/\/maintenance\/cycles\/\d+$/);
    cycleUrl = page.url();
    await expect(page.locator('app-page-header app-status-pill')).toHaveText('Issued');
    await expect(page.getByRole('link', { name: /^\d{6}-\d{4}$/ }).first()).toBeVisible();
  });

  test('records a part payment from the dues page', async ({ page }) => {
    await login(page, users.secretary);
    await page.goto('/maintenance');
    await page.getByRole('button', { name: `Record payment for flat ${FLAT}` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amount').fill('1000');
    await dialog.getByRole('radio', { name: /UPI/ }).click();
    await dialog.getByLabel('Transaction ID').fill('UPI-E2E-1');
    await dialog.getByLabel('Note').fill(note);
    await confirm(page, 'Record payment');
    await expect(page.getByText(/Payment recorded · receipt R-\d{6}/)).toBeVisible();
  });

  test('the resident sees what is left and the receipt', async ({ page }) => {
    await login(page, users.resident1001);
    await page.goto('/maintenance');
    await expect(page.getByText(`Flat ${FLAT}`)).toBeVisible();
    await expect(page.locator('.row .amount').first()).toHaveText(/1,500\.00/);
    await expect(page.getByRole('button', { name: 'Remind defaulters' })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Payments' }).click();
    await page.locator('a.row', { hasText: 'UPI' }).first().click();
    await expect(page).toHaveURL(/\/maintenance\/payments\/\d+$/);
    receiptUrl = page.url();
    await expect(page.getByText('₹1,000.00').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Void' })).toHaveCount(0);

    await page.getByRole('link', { name: /^\d{6}-\d{4}$/ }).click();
    await expect(page.locator('app-page-header app-status-pill')).toHaveText('Part paid');
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);

    // The printed bill shows only the bill document, with what is still due.
    await expect(page.getByRole('button', { name: 'Print bill' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-bill')).toBeVisible();
    await expect(page.locator('.print-bill .due')).toContainText('1,500.00');
    await expect(page.locator('.layout')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
  });

  test('a cycle with payments cannot be cancelled until they are voided', async ({ page }) => {
    await login(page, users.secretary);
    await page.goto(cycleUrl);
    await expect(page.getByRole('button', { name: 'Cancel cycle' })).toBeDisabled();

    await page.goto(receiptUrl);
    await page.getByRole('button', { name: 'Void' }).click();
    await giveReason(page, 'Void payment', 'Entered against the wrong flat');
    await expect(page.locator('app-page-header app-status-pill')).toHaveText('Void');
    await expect(page.getByText('Entered against the wrong flat')).toBeVisible();

    await page.goto(cycleUrl);
    await page.getByRole('button', { name: 'Cancel cycle' }).click();
    await giveReason(page, 'Cancel cycle', 'E2E test cycle');
    await expect(page.locator('app-page-header app-status-pill')).toHaveText('Cancelled');
  });
});
