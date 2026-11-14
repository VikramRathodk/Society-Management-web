import { APIRequestContext, Page, expect, test } from '@playwright/test';

import { SEED_PASSWORD, apiToken, users } from './support';

/**
 * Bank reconciliation end to end on a fresh society (each run leaves one "E2E Reconcile …" society
 * behind, as started books can't be deleted). The books start ten days ago with ₹50,000 in HDFC and get
 * hall rent, a security payment and two cheques by API; the secretary then adds the bank statement,
 * imports its CSV (columns guessed from the names), lets auto-match clear the plain lines, matches the
 * two-cheque deposit from the suggestions, records the bank charges from their line, completes the
 * reconciliation with no difference, sees the cleared dates in the bank book, and reopens it.
 */
const stamp = Date.now();
let secretaryPhone = '';
let societyId = 0;

function phone(): string {
  return '8' + String(Math.floor(100000000 + Math.random() * 899999999));
}

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** dd/MM/yyyy, as Indian bank exports have it. */
function bankDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

async function call(
  request: APIRequestContext,
  method: 'get' | 'post' | 'patch',
  path: string,
  token: string,
  data?: unknown,
) {
  const res = await request[method](path, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Phone').fill(secretaryPhone);
  await page.getByLabel('Password', { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

const start = isoDay(-10);
const days = { rent: isoDay(-8), security: isoDay(-7), cheques: isoDay(-6), charges: isoDay(-1) };

test.describe.serial('bank reconciliation', () => {
  test.beforeAll(async ({ request }) => {
    const admin = await apiToken(request, users.superAdmin);
    societyId = (
      await call(request, 'post', '/api/societies', admin, {
        name: `E2E Reconcile ${stamp}`,
        address: 'E2E',
        startLive: true,
      })
    ).id;
    secretaryPhone = phone();
    await call(request, 'post', '/api/users', admin, {
      name: 'E2E Treasurer',
      phone: secretaryPhone,
      password: SEED_PASSWORD,
      role: 'SECRETARY',
      societyId,
    });
    const sec = (
      await (
        await request.post('/api/auth/login', {
          data: { phone: secretaryPhone, password: SEED_PASSWORD },
        })
      ).json()
    ).token as string;

    const books = `/api/societies/${societyId}/finance`;
    await call(request, 'post', `${books}/chart`, sec);
    const hdfc = await call(request, 'post', `${books}/bank-accounts`, sec, {
      name: 'HDFC Savings',
      bankName: 'HDFC Bank',
      accountType: 'SAVINGS',
    });
    await call(request, 'post', `${books}/start`, sec, {
      startDate: start,
      openings: [{ accountId: hdfc.id, amount: 50000 }],
    });
    const accounts: { id: number; code: string }[] = await call(
      request,
      'get',
      `${books}/accounts`,
      sec,
    );
    const code = (c: string) => accounts.find((a) => a.code === c)!.id;
    const receipt = (date: string, amount: number, payee: string, reference?: string) =>
      call(request, 'post', `${books}/receipts`, sec, {
        date,
        depositAccountId: hdfc.id,
        lines: [{ accountId: code('4210'), amount }],
        payee,
        reference,
      });
    await receipt(days.rent, 5000, 'Tony Stark');
    await call(request, 'post', `${books}/payments`, sec, {
      date: days.security,
      payingAccountId: hdfc.id,
      lines: [{ accountId: code('5210'), amount: 800 }],
      payee: 'Shree Security',
    });
    await receipt(days.cheques, 1000, 'Bruce Banner', '100201');
    await receipt(days.cheques, 2000, 'Natasha Romanoff', '100202');
  });

  test('the secretary reconciles a month and completes it', async ({ page }) => {
    await signIn(page);
    await page.goto('/finance');
    await page
      .getByRole('tab', { name: 'Reconcile' })
      .or(page.getByRole('link', { name: 'Reconcile' }))
      .first()
      .click();
    await expect(page).toHaveURL(/\/finance\/reconcile/);

    // The first statement opens at the books' balance at the start of its first day.
    await page.getByRole('button', { name: 'New statement' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('From').fill(start);
    await dialog.getByLabel('To').fill(isoDay(0));
    await dialog.getByRole('button', { name: "Use the books' balance" }).click();
    await expect(dialog.getByLabel('Opening balance')).toHaveValue('50000');
    await dialog.getByLabel('Closing balance').fill('57050');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/finance\/reconcile\/statements\/\d+/);

    // Import: the columns are guessed from the names.
    const csv = [
      'Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      `${bankDay(days.rent)},NEFT CR TONY STARK HALL,N123,,5000.00,55000.00`,
      `${bankDay(days.security)},NEFT DR SHREE SECURITY,N124,800.00,,54200.00`,
      `${bankDay(days.cheques)},CHQ DEP 2 CHEQUES,CL55,,3000.00,57200.00`,
      `${bankDay(days.charges)},CHARGES SMS ALERTS,,150.00,,57050.00`,
    ].join('\n');
    await page.getByRole('button', { name: 'Import CSV' }).first().click();
    await page.getByTestId('statement-file').setInputFiles({
      name: 'hdfc.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await expect(page.getByText(/Guessed from the column names/)).toBeVisible();
    await expect(page.getByText(/4\s+lines/).first()).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Import 4 lines' }).click();
    await expect(page.getByText(/Imported 4 line\(s\); matched 2 automatically/)).toBeVisible();

    // The deposit of two cheques: one bank line, two entries.
    await page.getByTestId('bank-line').filter({ hasText: 'CHQ DEP 2 CHEQUES' }).click();
    await page.getByRole('button', { name: 'Match all' }).click();
    await expect(page.getByText('Matched 2 entries')).toBeVisible();

    // Bank charges the books don't have yet.
    await page
      .getByRole('button', { name: 'Actions for the line CHARGES SMS ALERTS', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Record entry from this line' }).click();
    const entry = page.getByRole('dialog');
    const select = entry.getByRole('combobox', { name: /What it was for/ });
    await select.focus();
    await select.press('Enter');
    await page.getByRole('option', { name: /5440 · Bank charges/ }).click();
    await entry.getByRole('button', { name: 'Record and match' }).click();
    await expect(page.getByText(/Recorded PV\/.* and matched it/)).toBeVisible();
    await expect(page.getByText('Every line is matched or set aside.')).toBeVisible();

    // The reconciliation statement adds up, and completes.
    await page.getByRole('tab', { name: 'Reconciliation statement' }).click();
    await expect(page.getByTestId('brs-difference')).toHaveText('₹0.00');
    await page.getByRole('button', { name: 'Complete reconciliation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Complete' }).click();
    await expect(page.getByText('Reconciled', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import CSV' })).toHaveCount(0);
  });

  test('the bank book shows when entries cleared, and the statement reopens', async ({ page }) => {
    await signIn(page);
    await page.goto('/finance/reconcile');
    await expect(page.getByText('Reconciled', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Bank book' }).click();
    await expect(page.getByRole('columnheader', { name: 'In the bank' })).toBeVisible();

    await page.goto('/finance/reconcile');
    await page.locator('a.row').first().click();
    await page.getByRole('tab', { name: 'Reconciliation statement' }).click();
    await page.getByRole('button', { name: 'Reopen' }).click();
    await page.getByRole('dialog').getByLabel('Why').fill('Bank sent a corrected statement');
    await page.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click();
    await expect(page.getByText(/Reopened .*: Bank sent a corrected statement/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import CSV' }).first()).toBeVisible();
  });
});
