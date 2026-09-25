import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_FIND_GROUP } from './global-setup';
import { menu, night, talk } from './talk';

/**
 * Finding a line again.
 *
 * The behaviour that matters: a word he half remembers brings back the line,
 * with who said it; a word nobody said brings back nothing and says so; and
 * the room's own lines never turn up, because they are furniture and would
 * bury the one line he wanted.
 */
test.describe.configure({ mode: 'serial' });

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_FIND_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

async function say(page: Page, body: string): Promise<void> {
  await page.getByLabel('Say something').fill(body);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('line').filter({ hasText: body })).toBeVisible();
}

async function openFind(page: Page): Promise<void> {
  await menu(page);
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Find something/ })
    .click();
  await expect(page.getByTestId('find')).toBeVisible();
}

test('a word brings the line back, and a word nobody said brings nothing', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Finder');
  await talk(marc);
  await say(marc, 'bedtime is the hardest part of the day');
  await say(marc, 'the barbecue was good though');

  await openFind(marc);
  await marc.getByLabel('Find something said').fill('bedtime');

  const found = marc.getByTestId('found');
  await expect(found).toHaveCount(1);
  await expect(found.first()).toContainText('bedtime is the hardest part');
  // Who said it is half the answer.
  await expect(found.first()).toContainText('Marc Finder');

  // And a word nobody said says so rather than showing an empty list.
  await marc.getByLabel('Find something said').fill('kayaking');
  await expect(marc.getByTestId('find-nothing')).toBeVisible();
  await expect(marc.getByTestId('found')).toHaveCount(0);

  await marc.context().close();
});

test('a photograph on a result is shown, not offered to be opened', async ({ browser }) => {
  // The viewer holds the photographs that are in the CONVERSATION, and a
  // result may be older than every line still loaded — so a result's picture
  // goes nowhere. It must therefore not be a button: one that does nothing is
  // still a button to a thumb and to a screen reader.
  const marc = await comeIn(browser, 'Marc Snapshot');
  await talk(marc);
  await marc.setInputFiles('#attach', {
    name: 'kayak.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await say(marc, 'down at the lake with the canoe');

  await openFind(marc);
  await marc.getByLabel('Find something said').fill('canoe');

  const found = marc.getByTestId('found');
  await expect(found).toHaveCount(1);
  await expect(found.first().locator('img')).toBeVisible();
  await expect(found.first().getByTestId('photo')).toHaveCount(0);

  await marc.context().close();
});

test('setting the night leaves nothing in the conversation to find', async ({ browser }) => {
  // This used to prove that search skipped the room's own lines. The room
  // writes none: setting a night is a thing home and the night sheet SHOW,
  // and a line about it was the app narrating its own state back at itself.
  const marc = await comeIn(browser, 'Marc Furniture');
  await night(marc);
  await marc.getByTestId('night-standing').click();
  await marc.getByLabel('Day', { exact: true }).selectOption('4');
  await marc.getByLabel('Time', { exact: true }).fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();
  await marc.getByRole('button', { name: 'Close', exact: true }).click();

  // Not in the conversation, and so not in the archive either.
  await talk(marc);
  await expect(marc.getByTestId('line').filter({ hasText: 'Marc Furniture' })).toHaveCount(0);
  await openFind(marc);
  await marc.getByLabel('Find something said').fill('Furniture');
  await expect(marc.getByTestId('find-nothing')).toBeVisible();

  await marc.context().close();
});
