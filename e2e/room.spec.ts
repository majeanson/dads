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

  // The count is on the room; the names are behind it, because on most
  // evenings knowing that two dads are here is the whole question.
  await expect(marc.getByTestId('connection')).toHaveText('2 here');
  await marc.getByTestId('connection').click();
  await expect(marc.getByTestId('roster-entry')).toHaveCount(2);

  // Coming and going is recorded there, and NOT in the conversation.
  await expect(marc.getByTestId('coming').filter({ hasText: 'Sam came in' })).toBeVisible();
  await marc.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(marc.getByTestId('line').filter({ hasText: 'came in' })).toHaveCount(0);

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

test('a dad sends a photo and the others see it', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // A real PNG, handed to the picker the way a phone hands one over.
  await marc.setInputFiles('#attach', {
    name: 'pool.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });

  // It waits for a caption rather than firing the moment it is picked.
  await expect(marc.getByTestId('pending-media')).toContainText('pool.png');
  await marc.getByLabel('Say something').fill('he finally jumped in');
  await marc.getByRole('button', { name: 'Send' }).click();

  const line = sam.getByTestId('line').filter({ hasText: 'he finally jumped in' });
  await expect(line).toBeVisible();
  const image = line.locator('img');
  await expect(image).toBeVisible();
  // The bytes really arrive: a broken image has no natural width.
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // And the composer is clear again.
  await expect(marc.getByTestId('pending-media')).toHaveCount(0);
  await expect(marc.getByLabel('Say something')).toHaveValue('');

  await marc.context().close();
  await sam.context().close();
});
