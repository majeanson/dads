import { expect, test } from '@playwright/test';
import { menu } from './talk';
import { E2E_GROUP } from './global-setup';

test('a stranger sees the door, not the room', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('The word')).toBeVisible();
  await expect(page.getByTestId('connection')).toHaveCount(0);
});

test('the wrong code is refused', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('The word').fill('not the code');
  await page.getByLabel('Your name').fill('Stranger');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByRole('alert')).toContainText("doesn't open anything");
  await expect(page.getByTestId('connection')).toHaveCount(0);
});

test('the right code lets a dad in, and he stays in on reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_GROUP.code.toUpperCase());
  await page.getByLabel('Your name').fill('Marc');
  await page.getByRole('button', { name: 'Come in' }).click();

  await expect(page.getByRole('heading', { name: E2E_GROUP.name })).toBeVisible();
  // The count in the header is the door to who is here.
  await page.getByTestId('connection').click();
  await expect(page.getByTestId('roster-entry').filter({ hasText: 'Marc (you)' })).toBeVisible();

  await page.reload();
  await page.getByTestId('connection').click();
  await expect(page.getByTestId('roster-entry').filter({ hasText: 'Marc (you)' })).toBeVisible();
});

test('signing out returns to the door', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_GROUP.code);
  await page.getByLabel('Your name').fill('Marc');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toBeVisible();

  await menu(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('The word')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('The word')).toBeVisible();
});

test('a stranger can look at an example room before he has a word, and nothing in it is real', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByLabel('The word')).toBeVisible();
  const before = requests.length;

  await page.getByTestId('door-example').click();
  const example = page.getByTestId('example');
  await expect(example).toBeVisible();
  await expect(example).toContainText('Nothing here is real');
  await expect(example).toContainText('Thursday, 9:00 pm');
  await expect(example.getByText('I’ll bring the cards.')).toBeVisible();
  // Text in the page: opening it asks the server for nothing.
  expect(requests.length).toBe(before);

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(example).toHaveCount(0);
  await expect(page.getByLabel('The word')).toBeVisible();
});
