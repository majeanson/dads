import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_EVENTS_GROUP } from './global-setup';
import { home, menu } from './talk';

// One group, one calendar: these would see each other's events in parallel.
test.describe.configure({ mode: 'serial' });

const DAY = 24 * 60 * 60 * 1000;

/** A date a few days out, as the field wants it. UTC, so it is never "today"
 * wherever the machine and the group disagree about midnight. */
function inDays(n: number): string {
  return new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
}

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_EVENTS_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

/** The calendar, from the menu. Anchored: a mark may follow the label. */
async function calendar(page: Page) {
  await menu(page);
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Calendar/ })
    .click();
  await expect(page.getByTestId('events')).toBeVisible();
}

test('a dad plans the bowling, the others see it and answer', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  await calendar(sam);
  await expect(sam.getByTestId('ev-nothing')).toBeVisible();

  await calendar(marc);
  await marc.getByTestId('ev-plan').click();
  await marc.getByLabel('What', { exact: true }).fill('Bowling');
  await marc.getByLabel('Where (optional)').fill('Le Strike');
  await marc.getByTestId('ev-day-field').fill(inDays(3));
  await marc.getByTestId('ev-time').fill('19:30');
  await marc.getByTestId('ev-save').click();

  const mine = marc.getByTestId('event').filter({ hasText: 'Bowling' });
  await expect(mine).toContainText('19:30');
  await expect(mine).toContainText('Le Strike');

  // Sam's open sheet keeps up without a reload, and the conversation says
  // nothing: an event is a thing the app SHOWS.
  const theirs = sam.getByTestId('event').filter({ hasText: 'Bowling' });
  await expect(theirs).toBeVisible();
  await expect(sam.getByTestId('line')).toHaveCount(0);

  // The author's controls are the author's.
  await expect(theirs.getByTestId('ev-edit')).toHaveCount(0);
  await expect(theirs.getByTestId('ev-cancel')).toHaveCount(0);
  await expect(mine.getByTestId('ev-edit')).toBeVisible();

  await theirs.getByTestId('ev-in').click();
  await expect(theirs.getByTestId('ev-who')).toContainText('In: Sam');
  await expect(mine.getByTestId('ev-who')).toContainText('In: Sam');

  // Changing his mind rewrites the answer rather than adding one.
  await theirs.getByTestId('ev-maybe').click();
  await expect(mine.getByTestId('ev-who')).toContainText('Might: Sam');
  await expect(mine.getByTestId('ev-who')).not.toContainText('In:');
});

test('the calendar marks the day it is on', async ({ browser }) => {
  const marc = await comeIn(browser, 'Mia');
  await calendar(marc);

  // Whatever month the planned day falls in, the grid can be paged to it.
  const target = marc.getByTestId('event').filter({ hasText: 'Bowling' });
  await expect(target).toBeVisible();
  const day = inDays(3);
  for (let i = 0; i < 2 && (await marc.locator(`[data-day="${day}"]`).count()) === 0; i++) {
    await marc.getByTestId('ev-next').click();
  }
  await expect(marc.locator(`[data-day="${day}"]`)).toHaveAttribute('data-event', '');

  // He did not put it up, so it is not his to change.
  await expect(target.getByTestId('ev-edit')).toHaveCount(0);
});

test('cancelling is armed, and takes the event off every screen', async ({ browser }) => {
  const dan = await comeIn(browser, 'Dan');
  const sam = await comeIn(browser, 'Sid');
  await calendar(dan);
  await dan.getByTestId('ev-plan').click();
  await dan.getByLabel('What', { exact: true }).fill('Barbecue');
  await dan.getByTestId('ev-day-field').fill(inDays(5));
  await dan.getByTestId('ev-save').click();

  await calendar(sam);
  const seen = sam.getByTestId('event').filter({ hasText: 'Barbecue' });
  await expect(seen).toBeVisible();

  let own = dan.getByTestId('event').filter({ hasText: 'Barbecue' });
  await own.getByTestId('ev-edit').click();
  await dan.getByLabel('What', { exact: true }).fill('Backyard barbecue');
  await dan.getByTestId('ev-save').click();
  own = dan.getByTestId('event').filter({ hasText: 'Backyard barbecue' });
  await expect(sam.getByTestId('event').filter({ hasText: 'Backyard barbecue' })).toBeVisible();

  await own.getByTestId('ev-cancel').click();
  // The first press only arms it.
  await expect(own).toBeVisible();
  await own.getByTestId('ev-cancel').click();
  await expect(own).toHaveCount(0);
  await expect(sam.getByTestId('event').filter({ hasText: 'barbecue' })).toHaveCount(0);
});

test('home points at what is coming and still fits a small phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 667 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_EVENTS_GROUP.code);
  await page.getByLabel('Your name').fill('Pat');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await home(page);

  const line = page.getByTestId('home-event');
  await expect(line).toContainText('Bowling');
  // Home never scrolls.
  const overflow = await page
    .getByTestId('home')
    .evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeLessThanOrEqual(0);

  await line.click();
  await expect(page.getByTestId('events')).toBeVisible();
});
