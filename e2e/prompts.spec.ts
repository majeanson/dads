import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_PROMPT_GROUP } from './global-setup';

// One group, one shared prompt pool and one day's question.
test.describe.configure({ mode: 'serial' });

/**
 * Scoped to the nav landmark on purpose: Playwright matches accessible names
 * by substring, and one of the curated prompts ends "...with no phone in the
 * room?", which otherwise collides with the Room button.
 */
function view(page: Page, name: 'Room' | 'Prompts') {
  return page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true });
}

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_PROMPT_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

test('the day’s question is asked, answered, and seen by the others', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // Both dads get the same question — it is the group's, not the browser's.
  const question = await marc.getByTestId('prompt-body').textContent();
  expect(question?.length).toBeGreaterThan(10);
  await expect(sam.getByTestId('prompt-body')).toHaveText(question!);

  await marc.getByRole('button', { name: 'Answer', exact: true }).click();
  await marc.getByLabel('Your answer').fill('I shouted about shoes. It was not about shoes.');
  await marc.getByRole('button', { name: 'Answer', exact: true }).click();

  const answer = sam.getByTestId('line').filter({ hasText: 'It was not about shoes' });
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('answered');
  await expect(marc.getByTestId('prompt-card')).toContainText('You’ve answered');

  await marc.context().close();
  await sam.context().close();
});

test('the whole library is browsable as a list, and a dad can add to it', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');

  await view(marc, 'Prompts').click();
  await expect(marc.getByTestId('prompt-list')).toBeVisible();

  // The curated library, plus the sections around it.
  await expect(marc.getByRole('heading', { name: /^The library/ })).toBeVisible();
  await expect(marc.getByRole('heading', { name: /^Asked before/ })).toBeVisible();
  await expect(marc.getByTestId('prompt-row').first()).toBeVisible();
  expect(await marc.getByTestId('prompt-row').count()).toBeGreaterThan(50);

  // Today's question shows up under Asked before, carrying its answer.
  await expect(marc.getByTestId('prompt-row').filter({ hasText: 'answer' }).first()).toBeVisible();

  // A dad adds one of his own; it appears immediately under Yours.
  const own = `What are you not saying to your kid? ${Date.now()}`;
  await marc.getByLabel('A question for the group').fill(own);
  await marc.getByRole('button', { name: 'Add' }).click();
  await expect(marc.getByTestId('prompt-row').filter({ hasText: own })).toBeVisible();
  await expect(marc.getByTestId('prompt-row').filter({ hasText: own })).toContainText('by Marc');

  // It survives a reload, and going back to the room still works.
  await marc.reload();
  await view(marc, 'Prompts').click();
  await expect(marc.getByTestId('prompt-row').filter({ hasText: own })).toBeVisible();
  await view(marc, 'Room').click();
  await expect(marc.getByTestId('prompt-card')).toBeVisible();

  await marc.context().close();
});
