import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_PICKS_GROUP } from './global-setup';
import { menu, talk } from './talk';

/**
 * The list of picks: what the room has recommended, mostly read off its own
 * lines. A link from a known site in the conversation is what puts a card
 * there, a line can be put there by hand (its menu, or the add box, which
 * posts an ordinary line), and taking the line back is what takes it away.
 */
test.describe.configure({ mode: 'serial' });

async function comeIn(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_PICKS_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
  // The suite does not depend on the network: every page is a made-up card.
  await page.route('**/api/unfurl?*', (route) => {
    const href = new URL(route.request().url()).searchParams.get('url') ?? '';
    return route.fulfill({
      json: {
        url: href,
        title: `Card for ${href.slice(-8)}`,
        description: null,
        image: null,
        site: 'Stub',
      },
    });
  });
}

async function say(page: Page, words: string): Promise<void> {
  await page.getByLabel('Say something').fill(words);
  await page.getByRole('button', { name: 'Send' }).click();
  // A link is shown shortened, so the line is found by the words before it.
  const needle = words.split(' https://')[0]!;
  await expect(page.getByTestId('line').filter({ hasText: needle })).toBeVisible();
}

async function openPicks(page: Page) {
  await menu(page);
  await page.getByTestId('menu-picks').click();
  const sheet = page.getByTestId('picks');
  await expect(sheet).toBeVisible();
  return sheet;
}

test('a link to something to watch is on the list, and a plain link is not', async ({ page }) => {
  await comeIn(page, 'Pia Picks');
  await say(page, 'this is good https://youtu.be/pickwatch01');
  await say(page, 'and this is just a page https://example.com/plain-page');

  const sheet = await openPicks(page);
  const picks = sheet.getByTestId('pick');
  await expect(picks).toHaveCount(1);
  const link = picks.getByTestId('pick-link');
  await expect(link).toHaveAttribute('href', 'https://youtu.be/pickwatch01');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toContainText('Card for');
  await expect(picks.first()).toContainText('Pia Picks');
  await expect(sheet.getByText('example.com')).toHaveCount(0);
});

test('the filter narrows to watch, listen or read', async ({ page }) => {
  await comeIn(page, 'Fil Filter');
  await say(page, 'seen it https://youtu.be/filterwatch1');
  await say(page, 'hear it https://open.spotify.com/track/filterlisten1');
  await say(page, 'read it https://www.goodreads.com/book/show/9999.Filter_Book');

  const sheet = await openPicks(page);
  // The room's other tests have put picks here too, so this test's three
  // are found by their addresses.
  const mine = (id: string) =>
    sheet.getByTestId('pick').filter({ has: page.locator(`a[href*="${id}"]`) });
  const picks = sheet.getByTestId('pick');
  await expect(mine('filterwatch1')).toHaveCount(1);
  await expect(mine('filterlisten1')).toHaveCount(1);
  await expect(mine('Filter_Book')).toHaveCount(1);
  // Newest first: the book was said last, so it is above the others.
  await expect(picks.first()).toHaveAttribute('data-category', 'read');
  await expect(picks.first().locator('a[href*="Filter_Book"]')).toHaveCount(1);

  const only = sheet.getByRole('group', { name: 'Show' });
  await only.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(mine('filterlisten1')).toHaveCount(1);
  await expect(mine('filterwatch1')).toHaveCount(0);
  await expect(mine('Filter_Book')).toHaveCount(0);
  await expect(sheet.locator('[data-testid=pick]:not([data-category=listen])')).toHaveCount(0);

  await only.getByRole('button', { name: 'Watch', exact: true }).click();
  await expect(mine('filterwatch1')).toHaveCount(1);
  await expect(mine('filterlisten1')).toHaveCount(0);
  await expect(sheet.locator('[data-testid=pick]:not([data-category=watch])')).toHaveCount(0);

  await only.getByRole('button', { name: 'All', exact: true }).click();
  await expect(mine('filterlisten1')).toHaveCount(1);
});

test('a line taken back leaves the list, and an empty list says so', async ({ page }) => {
  await comeIn(page, 'Tia Takeback');
  await say(page, 'oops wrong chat https://youtu.be/takenback001');

  let sheet = await openPicks(page);
  await expect(sheet.locator('a[href*="takenback001"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  await page.getByTestId('line').filter({ hasText: 'oops wrong chat' }).click({ button: 'right' });
  await page.getByTestId('line-retract').click();
  await page.getByTestId('line-retract').click();
  await expect(page.getByTestId('line').filter({ hasText: 'oops wrong chat' })).toHaveCount(0);

  sheet = await openPicks(page);
  // Wait for the list itself (the other tests' picks), then look for the one.
  await expect(sheet.getByTestId('pick').first()).toBeVisible();
  await expect(sheet.locator('a[href*="takenback001"]')).toHaveCount(0);
});

test('a room with nothing to show says so, for the room and for a filter', async ({ page }) => {
  await comeIn(page, 'Ella Empty');
  await page.route('**/api/picks*', (route) => route.fulfill({ json: { picks: [] } }));

  const sheet = await openPicks(page);
  await expect(sheet.getByTestId('picks-empty')).toContainText('Nothing yet');
  await sheet.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Read' }).click();
  await expect(sheet.getByTestId('picks-empty')).toHaveText('Nothing to read yet.');
});

/**
 * Putting a line on the list by hand, and taking it off again.
 *
 * Two dads, two fresh contexts: a fresh browser context is a fresh dad.
 */
async function stub(page: Page): Promise<void> {
  await page.route('**/api/unfurl?*', (route) =>
    route.fulfill({
      json: { url: 'x', title: 'A stubbed page', description: null, image: null, site: 'Stub' },
    }),
  );
}

async function second(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await comeIn(page, name);
  await stub(page);
  return page;
}

test('a plain line added from its menu is listed under Read with its words, for its adder to take off', async ({
  page,
  browser,
}) => {
  await comeIn(page, 'Ada Adds');
  const sam = await second(browser, 'Sam Sees');

  // Sam has the list open when Ada adds: it updates on its own.
  const samSheet = await openPicks(sam);

  await say(page, 'Dune by Herbert, the first one');
  const line = page.getByTestId('line').filter({ hasText: 'Dune by Herbert' });
  await line.click({ button: 'right' });
  const group = page.getByTestId('line-pick');
  await expect(group).toBeVisible();
  // Three plain choices, all inside the screen.
  const box = (await group.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByTestId('line-pick-read').click();
  await expect(page.getByText('On the list.')).toBeVisible();

  const theirs = samSheet.getByTestId('pick').filter({ hasText: 'Dune by Herbert' });
  await expect(theirs).toHaveCount(1);
  await expect(theirs).toHaveAttribute('data-category', 'read');
  await expect(theirs.getByTestId('pick-words')).toHaveText('Dune by Herbert, the first one');
  await expect(theirs.getByTestId('pick-link')).toHaveCount(0);
  await expect(theirs.getByTestId('pick-remove')).toHaveCount(0);

  const sheet = await openPicks(page);
  await sheet.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Read' }).click();
  const mine = sheet.getByTestId('pick').filter({ hasText: 'Dune by Herbert' });
  await expect(mine).toHaveCount(1);
  const remove = mine.getByTestId('pick-remove');
  await expect(remove).toHaveAccessibleName(/Take off the list: Dune by Herbert/);
  const target = (await remove.boundingBox())!;
  expect(target.height).toBeGreaterThanOrEqual(44);
  await remove.click();
  await expect(mine).toHaveCount(0);
  // The line itself stays in the conversation, and Sam's open list follows.
  await expect(theirs).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('line').filter({ hasText: 'Dune by Herbert' })).toBeVisible();
});

test('the menu does not offer the list for a line the list already recognises', async ({
  page,
}) => {
  await comeIn(page, 'Rex Recognised');
  await say(page, 'already there https://youtu.be/recognised01');
  await page.getByTestId('line').filter({ hasText: 'already there' }).click({ button: 'right' });
  await expect(page.getByTestId('line-menu')).toBeVisible();
  await expect(page.getByTestId('line-pick')).toHaveCount(0);
});

test('the add box posts a line in the conversation and lists it', async ({ page, browser }) => {
  await comeIn(page, 'Bea Box');
  const sam = await second(browser, 'Sam Sees Box');
  const samSheet = await openPicks(sam);

  const sheet = await openPicks(page);
  const open = sheet.getByTestId('picks-add-open');
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');

  // Read is the kind a link cannot find, so it is the one he starts on.
  await expect(sheet.getByTestId('picks-add-read')).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByTestId('picks-add-listen').click();
  await expect(sheet.getByTestId('picks-add-listen')).toHaveAttribute('aria-pressed', 'true');

  const field = sheet.getByLabel('A title or a link');
  await field.fill('Kind of Blue, Miles Davis');
  await sheet.getByTestId('picks-add-send').click();
  await expect(field).toHaveValue('');
  await expect(sheet.getByTestId('picks-added')).toBeVisible();

  const card = sheet.getByTestId('pick').filter({ hasText: 'Kind of Blue' });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-category', 'listen');
  await expect(card.getByTestId('pick-remove')).toBeVisible();
  const theirs = samSheet.getByTestId('pick').filter({ hasText: 'Kind of Blue' });
  await expect(theirs).toHaveAttribute('data-category', 'listen');
  await expect(theirs.getByTestId('pick-remove')).toHaveCount(0);

  await page.keyboard.press('Escape');
  const line = page.getByTestId('line').filter({ hasText: 'Kind of Blue' });
  await expect(line).toBeVisible();

  // Taking the line back takes it off the list.
  await line.click({ button: 'right' });
  await page.getByTestId('line-retract').click();
  await page.getByTestId('line-retract').click();
  await expect(line).toHaveCount(0);
  await expect(theirs).toHaveCount(0);
});
