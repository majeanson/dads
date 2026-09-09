import { expect, test } from '@playwright/test';
import { E2E_GROUP } from './global-setup';

test('a stranger sees the door, not the room', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Code')).toBeVisible();
  await expect(page.getByTestId('whoami')).toHaveCount(0);
});

test('the wrong code is refused', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Code').fill('not the code');
  await page.getByLabel('Your name').fill('Stranger');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByRole('alert')).toContainText("doesn't open anything");
  await expect(page.getByTestId('whoami')).toHaveCount(0);
});

test('the right code lets a dad in, and he stays in on reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_GROUP.code.toUpperCase());
  await page.getByLabel('Your name').fill('Marc');
  await page.getByRole('button', { name: 'Come in' }).click();

  await expect(page.getByRole('heading', { name: E2E_GROUP.name })).toBeVisible();
  await expect(page.getByTestId('whoami')).toHaveText('You’re in as Marc.');

  await page.reload();
  await expect(page.getByTestId('whoami')).toHaveText('You’re in as Marc.');
});

test('signing out returns to the door', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_GROUP.code);
  await page.getByLabel('Your name').fill('Marc');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('whoami')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Code')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Code')).toBeVisible();
});
