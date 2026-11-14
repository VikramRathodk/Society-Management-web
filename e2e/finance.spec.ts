import { APIRequestContext, Page, expect, test } from '@playwright/test';

import { SEED_PASSWORD, apiToken, users } from './support';

/**
 * Finance end to end on a fresh society (never the seeded one: a society whose books are started can't
 * be deleted, so each run leaves one "E2E Finance …" society behind). The secretary sets the books up,
 * records income and an expense that waits for approval, voids an entry, reads the statements and
 * takes an overpayment that becomes credit and is partly refunded; the committee approves the expense;
 * the resident sees the shared summary only.
 */
const stamp = Date.now();
const people = { secretary: '', committee: '', resident: '' };
let societyId = 0;

function phone(): string {
  return '8' + String(Math.floor(100000000 + Math.random() * 899999999));
}

async function call(
  request: APIRequestContext,
  method: 'post' | 'patch',
  path: string,
  token: string,
  data: unknown,
) {
  const res = await request[method](path, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function signIn(page: Page, who: keyof typeof people): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Phone').fill(people[who]);
  await page.getByLabel('Password', { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

// Opens a Material select with the keyboard: while it is empty its floating label lies over the trigger
// and catches pointer clicks (a person clicking the label opens it anyway).
async function pick(page: Page, label: string, option: RegExp): Promise<void> {
  const select = page.getByRole('dialog').getByRole('combobox', { name: label });
  await select.focus();
  await select.press('Enter');
  await page.getByRole('option', { name: option }).click();
}

test.describe.serial('finance', () => {
  let waitingUrl = '';

  test.beforeAll(async ({ request }) => {
    const admin = await apiToken(request, users.superAdmin);
    societyId = (
      await call(request, 'post', '/api/societies', admin, {
        name: `E2E Finance ${stamp}`,
        address: 'E2E',
        // A running society moving in: residents are added straight away.
        startLive: true,
      })
    ).id;
    const wing = await call(request, 'post', `/api/societies/${societyId}/wings`, admin, {
      name: 'A',
    });
    const flat = await call(request, 'post', `/api/wings/${wing.id}/flats`, admin, {
      flatNumber: '101',
    });
    for (const [key, role, flatId] of [
      ['secretary', 'SECRETARY', undefined],
      ['committee', 'COMMITTEE', undefined],
      ['resident', 'RESIDENT', flat.id],
    ] as const) {
      people[key] = phone();
      await call(request, 'post', '/api/users', admin, {
        name: `E2E ${role}`,
        phone: people[key],
        password: SEED_PASSWORD,
        role,
        societyId,
        flatId,
      });
    }
    const login = await request.post('/api/auth/login', {
      data: { phone: people.secretary, password: SEED_PASSWORD },
    });
    const sec = (await login.json()).token as string;
    await call(request, 'post', `/api/societies/${societyId}/maintenance/charge-heads`, sec, {
      name: 'Maintenance',
      calcType: 'FIXED',
      amount: 2000,
    });
  });

  test('the secretary sets up and starts the books', async ({ page }) => {
    await signIn(page, 'secretary');
    await page.getByRole('link', { name: 'Finance' }).first().click();
    await page.getByRole('button', { name: 'Create the standard chart' }).click();
    await expect(page.getByText(/Ready: \d+ accounts/)).toBeVisible();

    await page.getByRole('button', { name: 'Add bank account' }).click();
    const bank = page.getByRole('dialog');
    await bank.getByLabel('Name in the books').fill('HDFC Savings');
    await bank.getByLabel('Bank', { exact: true }).fill('HDFC Bank');
    await bank.getByLabel('Last 4 digits (optional)').fill('4321');
    await bank.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('HDFC Bank · Savings · ••4321')).toBeVisible();

    await page.getByLabel('Opening balance of Cash in hand').fill('10000');
    await page.getByLabel('Opening balance of HDFC Savings').fill('50000');
    await expect(page.getByText('₹60,000.00')).toBeVisible(); // the General fund
    await page.getByRole('button', { name: 'Start the books' }).click();
    await expect(page.getByRole('button', { name: 'Record income' })).toBeVisible();
  });

  test('income posts, a large expense waits, and a void books a reversal', async ({
    page,
    request,
  }) => {
    await signIn(page, 'secretary');
    await page.goto('/finance');
    await page.getByRole('button', { name: 'Record income' }).click();
    await pick(page, 'Income or other account', /4210 · Hall & clubhouse rent/);
    await page.getByRole('dialog').getByLabel('Amount').fill('5000');
    await page.getByRole('dialog').getByLabel('Received from (optional)').fill('Tony Stark');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: /RV\// })).toBeVisible();
    const receiptUrl = page.url();

    const sec = (
      await (
        await request.post('/api/auth/login', {
          data: { phone: people.secretary, password: SEED_PASSWORD },
        })
      ).json()
    ).token;
    await call(request, 'patch', `/api/societies/${societyId}/settings`, sec, {
      financeApprovalAbove: 1000,
    });
    await page.goto('/finance/entries?new=PAYMENT');
    await pick(page, 'Expense or other account', /5210 · Security/);
    await page.getByRole('dialog').getByLabel('Amount').fill('12000');
    await page.getByRole('dialog').getByLabel('Paid to').fill('Shree Security');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Waiting for approval', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Withdraw' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0); // never the maker
    waitingUrl = page.url();

    await page.goto(receiptUrl);
    await page.getByRole('button', { name: 'Void' }).click();
    await page.getByRole('dialog').getByLabel('Reason').fill('Booking cancelled');
    await page.getByRole('dialog').getByRole('button', { name: 'Void' }).click();
    await expect(page.getByText(/Reversed by RV\//)).toBeVisible();
  });

  test('the committee approves the waiting expense', async ({ page }) => {
    await signIn(page, 'committee');
    await page.goto(waitingUrl);
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Posted', { exact: true })).toBeVisible();
  });

  test('the statements balance', async ({ page }) => {
    await signIn(page, 'secretary');
    await page.goto('/finance/reports?report=balance-sheet');
    await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Trial balance' }).click();
    await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Receipts & Payments' }).click();
    await expect(page.getByText('Opening cash and bank')).toBeVisible();
    await page.getByRole('radio', { name: 'Income & Expenditure' }).click();
    await expect(page.getByText(/Surplus|Deficit/).first()).toBeVisible();
  });

  test('an overpayment becomes credit, part of it is refunded, and the books agree', async ({
    page,
    request,
  }) => {
    const sec = (
      await (
        await request.post('/api/auth/login', {
          data: { phone: people.secretary, password: SEED_PASSWORD },
        })
      ).json()
    ).token;
    await call(request, 'post', `/api/societies/${societyId}/maintenance/cycles`, sec, {
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      dueDate: '2026-11-15',
    });
    await signIn(page, 'secretary');
    await page.goto('/maintenance');
    await page.getByRole('button', { name: /Record payment for flat A-101/ }).click();
    await page.getByRole('dialog').getByLabel('Amount').fill('5000');
    await pick(page, 'Into account (books)', /^HDFC Savings$/);
    await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Credit ₹3,000.00')).toBeVisible();

    await page.getByRole('button', { name: /Refund credit of flat A-101/ }).click();
    await page.getByRole('dialog').getByLabel('Amount').fill('500');
    await page.getByRole('dialog').getByLabel('Reason').fill('Owner asked');
    await page.getByRole('dialog').getByRole('button', { name: 'Refund' }).click();
    await expect(page.getByText('Credit ₹2,500.00')).toBeVisible();

    await page.goto('/finance/settings');
    await expect(page.getByText(/agree with maintenance/)).toBeVisible();
  });

  test('residents see the shared summary but not the books', async ({ page, request }) => {
    const sec = (
      await (
        await request.post('/api/auth/login', {
          data: { phone: people.secretary, password: SEED_PASSWORD },
        })
      ).json()
    ).token;
    await call(request, 'patch', `/api/societies/${societyId}/settings`, sec, {
      residentsSeeFinanceSummary: true,
    });
    await signIn(page, 'resident');
    await expect(page.getByRole('link', { name: 'Finance' })).toHaveCount(0);
    await expect(page.getByText('Society finances')).toBeVisible();
  });
});
