import { expect, test, type Browser, type Page } from '@playwright/test';
import { menu, talk } from './talk';
import { E2E_PROMPT_GROUP } from './global-setup';

// One group, one shared prompt pool and one day's question.
test.describe.configure({ mode: 'serial' });

/**
 * Everything that is not the conversation lives behind the one Menu button.
 *
 * Scoped to the menu because Playwright matches accessible names by substring,
 * and one curated prompt ends "...with no phone in the room?". Anchored regex
 * rather than an exact name: an item with something waiting is called
 * "The week — something waiting", which is exactly what a screen reader should
 * hear, and the label is the prefix.
 */
async function open(page: Page, name: 'Questions' | 'The week' | 'Open the table' | 'Dad night') {
  await menu(page);
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
}

/** Shut whatever sheet is open and go back to the conversation. */
async function close(page: Page) {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_PROMPT_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
  return page;
}

test('the day’s question is asked, answered, and seen by the others', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // The question is not in the conversation's way: it waits behind the menu,
  // which carries a mark until you have answered it.
  await expect(marc.getByTestId('prompt-card')).toHaveCount(0);
  await expect(marc.getByTestId('mark-menu')).toBeVisible();
  await open(marc, 'Questions');
  await open(sam, 'Questions');

  // Both dads get the same question — it is the group's, not the browser's.
  const question = await marc.getByTestId('prompt-body').textContent();
  expect(question?.length).toBeGreaterThan(10);
  await expect(sam.getByTestId('prompt-body')).toHaveText(question!);

  await marc.getByRole('button', { name: 'Answer', exact: true }).click();
  await marc.getByLabel('Your answer').fill('I shouted about shoes. It was not about shoes.');
  await marc.getByRole('button', { name: 'Answer', exact: true }).click();

  // The answer lands in the conversation, where the others read it.
  await close(sam);
  const answer = sam.getByTestId('line').filter({ hasText: 'It was not about shoes' });
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('answered');
  await expect(marc.getByTestId('prompt-card')).toContainText('You answered');

  await marc.context().close();
  await sam.context().close();
});

test('what the group was asked before is readable, and a dad can add one', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');

  await open(marc, 'Questions');

  // Today's question is the screen. What was asked before is behind one row
  // — on a phone it was a scroll past the one question that matters — and
  // the row carries no count while there is nothing behind it.
  await expect(marc.getByTestId('prompt-list')).toHaveCount(0);
  await expect(marc.getByLabel('A question for the group')).toBeVisible();

  // A dad adds one of his own, from today's screen.
  const own = `What are you not saying to your kid? ${Date.now()}`;
  await marc.getByLabel('A question for the group').fill(own);
  // Scoped: the composer's own attach control is also a button, and
  // Playwright matches accessible names by substring.
  await marc.getByTestId('prompt-add').getByRole('button', { name: 'Add', exact: true }).click();

  await marc.getByTestId('prompt-history').click();
  await expect(marc.getByTestId('prompt-list')).toBeVisible();

  // Not the curated hundred: they are a pool to draw from, not reading
  // material. This group has only ever been asked today's question, so
  // "before" says so in words rather than listing nothing.
  await expect(marc.getByText('Nothing before today.')).toBeVisible();

  // Today's question is printed once, on the card, and is NOT repeated here.
  await marc.getByTestId('prompt-today').click();
  const question = await marc.getByTestId('prompt-body').textContent();
  await marc.getByTestId('prompt-history').click();
  await expect(marc.getByTestId('prompt-row').filter({ hasText: question! })).toHaveCount(0);

  // His own is here, under the group's questions, with his name on it.
  await expect(marc.getByTestId('prompt-row').filter({ hasText: own })).toBeVisible();
  await expect(marc.getByTestId('prompt-row').filter({ hasText: own })).toContainText('by Marc');

  // It survives a reload, the row counts it, and going back to the room
  // still works.
  await marc.reload();
  await open(marc, 'Questions');
  await expect(marc.getByTestId('prompt-history')).toContainText('1 asked');
  await marc.getByTestId('prompt-history').click();
  await expect(marc.getByTestId('prompt-row').filter({ hasText: own })).toBeVisible();
  await close(marc);
  await talk(marc);
  await expect(marc.getByLabel('Say something')).toBeVisible();

  await marc.context().close();
});
