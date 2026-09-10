import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_BOARD_GROUP } from './global-setup';

// One group, one shared board.
test.describe.configure({ mode: 'serial' });

/**
 * Scoped to the tab strip because Playwright matches accessible names by
 * substring, and one curated prompt ends "...with no phone in the room?".
 */
function tab(page: Page, name: 'Today' | 'Table' | 'Prompts' | 'Board') {
  // Anchored regex, not an exact match: a tab with something waiting is named
  // "Board — something waiting", which is exactly what a screen reader should
  // hear. The label is the prefix.
  return page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
}

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_BOARD_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

test('a dad checks in and commits, and the others see both', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // A blank week is something waiting, and the tab says so.
  await expect(marc.getByTestId('mark-board')).toBeVisible();

  await tab(marc, 'Board').click();
  await expect(marc.getByTestId('your-week')).toBeVisible();

  // Sam starts blank on Marc's board — everyone gets a row either way.
  await expect(marc.getByTestId('board-row').filter({ hasText: 'Sam' })).toContainText(
    'nothing yet',
  );

  await marc.getByRole('radio', { name: '2 — hard' }).check();
  await marc.getByLabel('One line about your week').fill('Shouted about shoes.');
  await marc.getByRole('button', { name: 'Check in' }).click();
  await expect(
    marc.getByTestId('board-row').filter({ hasText: 'Marc (you)' }).first(),
  ).toContainText('2/5');

  await marc.getByLabel('One thing to try this week').fill('Phone in the drawer at six');
  await marc.getByRole('button', { name: 'Commit' }).click();
  await expect(marc.getByTestId('your-week')).toBeVisible();

  // The room heard about both, live, without Sam reloading.
  await expect(
    sam.getByTestId('line').filter({ hasText: 'Marc checked in — 2/5. Shouted about shoes.' }),
  ).toBeVisible();
  await expect(
    sam.getByTestId('line').filter({ hasText: 'Marc is trying this week: Phone in the drawer' }),
  ).toBeVisible();

  // And Sam's board shows Marc's week.
  await tab(sam, 'Board').click();
  const marcRow = sam.getByTestId('board-row').filter({ hasText: 'Marc' }).first();
  await expect(marcRow).toContainText('2/5');
  await expect(marcRow).toContainText('Phone in the drawer at six');
  await expect(marcRow).toContainText('trying');

  await marc.context().close();
  await sam.context().close();
});

test('a check-in survives a reload, and the tabs still work', async ({ browser }) => {
  // A fresh context is a fresh device, so this is a different dad from the
  // one above — hence a name of his own.
  const dave = await comeIn(browser, 'Dave');
  await tab(dave, 'Board').click();

  await dave.getByRole('radio', { name: '5 — great' }).check();
  await dave.getByLabel('One line about your week').fill('Good week, for once.');
  await dave.getByRole('button', { name: 'Check in' }).click();

  const daveRow = dave.getByTestId('board-row').filter({ hasText: 'Dave (you)' }).first();
  await expect(daveRow).toContainText('5/5');

  await dave.reload();
  await tab(dave, 'Board').click();
  await expect(
    dave.getByTestId('board-row').filter({ hasText: 'Dave (you)' }).first(),
  ).toContainText('Good week, for once.');

  // Back to the conversation, which is all the Today tab is now.
  await tab(dave, 'Today').click();
  await expect(dave.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(dave.getByTestId('prompt-card')).toHaveCount(0);

  await dave.context().close();
});
