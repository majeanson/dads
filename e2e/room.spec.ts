import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_ROOM_GROUP } from './global-setup';

// One room, one roster: these tests would see each other's dads if they ran
// at the same time.
test.describe.configure({ mode: 'serial' });

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

test('two dads see each other and each other’s lines', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  await expect(marc.getByTestId('roster-entry')).toHaveCount(2);
  await expect(sam.getByTestId('roster-entry')).toHaveCount(2);
  await expect(marc.getByTestId('connection')).toHaveText('2 here');

  await marc.getByLabel('Say something').fill('rough bedtime tonight');
  await marc.getByRole('button', { name: 'Send' }).click();

  await expect(sam.getByTestId('line').filter({ hasText: 'rough bedtime tonight' })).toBeVisible();
  await expect(marc.getByTestId('line').filter({ hasText: 'rough bedtime tonight' })).toBeVisible();
  await expect(marc.getByLabel('Say something')).toHaveValue('');

  await sam.getByLabel('Say something').fill('same here, twice');
  await sam.getByLabel('Say something').press('Enter');
  await expect(marc.getByTestId('line').filter({ hasText: 'same here, twice' })).toBeVisible();

  await marc.context().close();
  await sam.context().close();
});

test('a dad who reloads keeps the evening’s lines', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  await marc.getByLabel('Say something').fill('before the reload');
  await marc.getByLabel('Say something').press('Enter');
  await expect(marc.getByTestId('line').filter({ hasText: 'before the reload' })).toBeVisible();

  await marc.reload();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await expect(marc.getByTestId('line').filter({ hasText: 'before the reload' })).toBeVisible();

  await marc.context().close();
});
