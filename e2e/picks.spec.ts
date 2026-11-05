import { expect, test, type Page } from '@playwright/test';
import { E2E_PICKS_GROUP } from './global-setup';
import { menu, talk } from './talk';

/**
 * The list of picks: what the room has recommended, read off its own lines.
 * Nothing is posted from the sheet; a link from a known site in the
 * conversation is what puts a card there, and taking the line back is what
 * takes it away.
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
