import { APIRequestContext, Page, expect } from '@playwright/test';

/** Dev seed users (scripts/dev-seed.sql); every password is the seed default. */
export const SEED_PASSWORD = 'Pass@123';
export const users = {
  superAdmin: { phone: '9000000999', name: 'Stan Lee' },
  secretary: { phone: '9000000616', name: 'Nick Fury' },
  committee: { phone: '9000000001', name: 'Steve Rogers' },
  guard: { phone: '9000000002', name: 'Happy Hogan' },
  residentPenthouse: { phone: '9000000003', name: 'Tony Stark' },
  resident1001: { phone: '9000000007', name: 'Wanda Maximoff' },
} as const;

export type SeedUser = (typeof users)[keyof typeof users];

export async function login(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Phone').fill(user.phone);
  await page.getByLabel('Password', { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Bearer token for direct API calls (setup and cleanup only). */
export async function apiToken(request: APIRequestContext, user: SeedUser): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { phone: user.phone, password: SEED_PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

/** Picks an option from a Material select by its label. */
export async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
