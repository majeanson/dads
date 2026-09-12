import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_FIND_GROUP } from './global-setup';
import { talk } from './talk';

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
  await page.getByRole('button', { name: 'Menu' }).click();
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

test('the room’s own lines are not findable', async ({ browser }) => {
  // Setting the night makes the room say so, by name — a line nobody typed.
  const marc = await comeIn(browser, 'Marc Furniture');
  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('dad-night').click();
  await marc.getByLabel('Day').selectOption('4');
  await marc.getByLabel('Time').fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();
  await marc.getByRole('button', { name: 'Close', exact: true }).click();

  await talk(marc);
  await expect(marc.getByTestId('line').filter({ hasText: 'Marc Furniture' })).toBeVisible();

  // His own name is in that line, and it is still not a result.
  await openFind(marc);
  await marc.getByLabel('Find something said').fill('Furniture');
  await expect(marc.getByTestId('find-nothing')).toBeVisible();

  await marc.context().close();
});
