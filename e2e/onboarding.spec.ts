import { Page, expect, test } from '@playwright/test';

import { login, logout, users } from './support';

/**
 * Society onboarding, both ways in, on fresh societies (each run leaves two "E2E …" societies behind).
 *
 * Platform-led: the super admin creates a society with its secretary; the secretary joins through the
 * invitation link, fills in the profile, generates wings and flats, stages a residents sheet and goes
 * live, which sends the sheet and offers the links CSV.
 *
 * Self-signup: a secretary registers from the landing page, the super admin approves it, and the new
 * secretary signs in to a society in setup.
 *
 * Self-signup allows 5 registrations per address per hour (APPLICATIONS_PER_IP_PER_HOUR on the API).
 */
const stamp = Date.now();
const PASSWORD = 'Onboard@123';

function phone(): string {
  return '6' + String(Math.floor(100000000 + Math.random() * 899999999));
}

async function signIn(page: Page, phoneNumber: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Phone').fill(phoneNumber);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function step(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name }).click();
}

test.describe.serial('society onboarding', () => {
  test('platform-led: create with a secretary, set up, go live with a residents sheet', async ({
    page,
  }) => {
    const society = `E2E Onboard ${stamp}`;
    const secretaryPhone = phone();

    // The super admin creates the society and its secretary's invitation.
    await login(page, users.superAdmin);
    await page.goto('/societies');
    await page.getByRole('button', { name: 'New society' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(society);
    await dialog.getByLabel("Secretary's name").fill('Olivia Onboard');
    await dialog.getByLabel("Secretary's phone").fill(secretaryPhone);
    await dialog.getByRole('button', { name: 'Create and invite' }).click();
    await expect(dialog.getByText(`${society} is ready`)).toBeVisible();
    const link = (await dialog.getByTestId('invite-link').textContent())!.trim();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('row', { name: new RegExp(society) })).toContainText('Setting up');
    await logout(page);

    // The secretary joins with the link.
    await page.goto(new URL(link).pathname);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account and join' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // The banner leads to the setup.
    await expect(page.getByText(`${society} is being set up`)).toBeVisible();
    await page.getByRole('link', { name: 'Continue setup' }).click();
    await expect(page).toHaveURL(/\/societies\/\d+\/setup/);

    // Step 1: the profile.
    await page.getByLabel('Address').fill('Plot 7, Hinjewadi Phase 1');
    await page.getByLabel('City').fill('Pune');
    await page.getByLabel('State').fill('Maharashtra');
    await page.getByLabel('PIN code').fill('411057');
    await page.getByLabel('Contact phone').fill(secretaryPhone);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible();

    // Step 2: wings and flats from a pattern.
    await step(page, /Wings & flats/);
    await page.getByLabel('From floor').fill('1');
    await page.getByLabel('To floor').fill('2');
    await page.getByLabel('Flats per floor').fill('2');
    await expect(page.getByTestId('sample')).toContainText('101, 102, 201');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('4 new flats')).toBeVisible();
    await page.getByRole('button', { name: 'Create 4 flats' }).click();
    await expect(page.getByText('Created 4 flats').first()).toBeVisible();

    // Step 3: residents from a sheet, staged until go-live.
    await step(page, /Residents/);
    const sheet = [
      'Flat,Name,Phone,Owner/Tenant',
      `A-101,Meera Shah,${phone()},Owner`,
      `A-102,Ravi Kumar,${phone()},Tenant`,
      `A-999,Nobody Here,${phone()},Owner`,
    ].join('\n');
    await page.getByTestId('sheet-input').setInputFiles({
      name: 'residents.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(sheet),
    });
    await expect(page.getByText('2 ready', { exact: true })).toBeVisible();
    await expect(page.getByText('1 with problems', { exact: true })).toBeVisible();
    await expect(page.getByText('No flat A-999 in this society')).toBeVisible();
    await expect(page.getByText(/become invitations when the society goes live/)).toBeVisible();

    // Step 5: go live, which sends the sheet.
    await step(page, /Go live/);
    await expect(page.getByText(/The 2 residents in your sheet are invited straight away/)).toBeVisible();
    await page.getByRole('button', { name: 'Go live' }).last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Go live' }).click();
    await expect(page.getByText(`${society} is live`).first()).toBeVisible();
    await expect(page.getByText('2 invitations sent')).toBeVisible();
    await expect(page.getByText('1 rows were left out')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Links CSV' }).click();
    const csv = await download;
    expect(csv.suggestedFilename()).toMatch(/resident-invitations\.csv$/);

    // Live now: no banner.
    await page.goto('/dashboard');
    await expect(page.getByText('is being set up')).toHaveCount(0);
  });

  test('self-signup: register from the site, approved by the platform, sign in to set up', async ({
    page,
  }) => {
    const society = `E2E Signup ${stamp}`;
    const applicantPhone = phone();

    await page.goto('/');
    await page.getByRole('link', { name: 'Register your society' }).first().click();
    await expect(page).toHaveURL(/\/register-society/);
    await page.getByLabel('Society name').fill(society);
    await page.getByLabel('City').fill('Nashik');
    await page.getByLabel('About how many flats').fill('64');
    await page.getByLabel('Your name').fill('Sam Signup');
    await page.getByLabel('Phone').fill(applicantPhone);
    await page.getByLabel('Choose a password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Register society' }).click();
    await expect(page.getByText("Thanks! We'll call you.")).toBeVisible();
    const number = (await page.getByTestId('application-number').textContent())!.replace('#', '');

    // Checking on it: still waiting.
    await page.getByRole('button', { name: 'Check status' }).click();
    await expect(page.getByText("We haven't called yet")).toBeVisible();

    // The super admin approves it.
    await login(page, users.superAdmin);
    await page.goto('/registrations');
    const card = page.getByRole('article', { name: society });
    await expect(card).toContainText('Sam Signup');
    await expect(card).toContainText(`#${number}`);
    await card.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(`${society} approved`)).toBeVisible();
    await logout(page);

    // The applicant signs in with the password they chose and lands on a society in setup.
    await signIn(page, applicantPhone);
    await expect(page.getByText(`${society} is being set up`)).toBeVisible();
    await page.getByRole('link', { name: 'Continue setup' }).click();
    await expect(page.getByRole('heading', { name: society })).toBeVisible();
    await expect(page.getByLabel('City')).toHaveValue('Nashik');
  });
});
