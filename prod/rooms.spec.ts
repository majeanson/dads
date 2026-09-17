import { expect, test, type Browser, type Page } from '@playwright/test';
import { MARK, named, talk } from './names';

/**
 * A room opened through the app, on the real deployment.
 *
 * Everything else in `prod/` walks into the dads' own room. This one makes
 * its own — which the app could not do until today — and that is the point:
 * the door that mints a group, the word that has to be unique across the live
 * database, the creator who owns the switches, and the calendar that picks a
 * night. The teardown deletes the room as well as the men in it.
 *
 * Serial, and it opens exactly ONE room: three per address per day is the
 * real limit on the real Worker, and a suite that spends the budget cannot be
 * re-run this afternoon.
 */
test.describe.configure({ mode: 'serial' });

/** Unique per run: the word is UNIQUE across every room in the live database,
 * and yesterday's run is still in there if a sweep ever failed. */
const WORD = `${MARK}word ${Math.random().toString(36).slice(2, 8)}`;
const ROOM = named('room');

async function atTheDoor(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  return page;
}

test('a dad opens a room on the real thing, and a second dad joins it', async ({ browser }) => {
  const maker = await atTheDoor(browser);
  await maker.getByTestId('start-room').click();
  await maker.getByLabel('What to call it').fill(ROOM);
  await maker.getByLabel('The word to get in').fill(WORD);
  await maker.getByLabel('Your name').fill(named('maker'));
  await maker.getByTestId('open-room').click();

  // Through the real door: a real group row, a real member, a real cookie.
  await expect(maker.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });
  await expect(maker.getByRole('heading', { name: ROOM })).toBeVisible();

  const guest = await atTheDoor(browser);
  await guest.getByLabel('Code').fill(WORD);
  await guest.getByLabel('Your name').fill(named('guest'));
  await guest.getByRole('button', { name: 'Come in' }).click();
  await expect(guest.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });
  await expect(guest.getByRole('heading', { name: ROOM })).toBeVisible();
  await expect(maker.getByTestId('connection')).toHaveText('2 here', { timeout: 20_000 });

  // And a line crosses between them over the real socket.
  await talk(maker);
  await talk(guest);
  const said = `${MARK}first line`;
  await maker.getByLabel('Say something').fill(said);
  await maker.getByRole('button', { name: 'Send' }).click();
  await expect(guest.getByTestId('line').filter({ hasText: said })).toBeVisible({
    timeout: 15_000,
  });

  await maker.context().close();
  await guest.context().close();
});

test('the word it was opened with is taken, for everybody', async ({ browser }) => {
  // Unique across the whole live database, which is the thing that cannot be
  // tested anywhere else: two rooms behind one word would hand a dad who
  // typed the right thing a room full of strangers.
  const page = await atTheDoor(browser);
  await page.getByTestId('start-room').click();
  await page.getByLabel('What to call it').fill(`${ROOM} again`);
  await page.getByLabel('The word to get in').fill(WORD);
  await page.getByLabel('Your name').fill(named('clash'));
  await page.getByTestId('open-room').click();

  await expect(page.getByRole('alert')).toContainText('already uses that word');
  await expect(page.getByTestId('connection')).toHaveCount(0);
  await page.context().close();
});

test('its creator owns the switches, and a guest does not', async ({ browser }) => {
  const maker = await atTheDoor(browser);
  await maker.getByLabel('Code').fill(WORD);
  await maker.getByLabel('Your name').fill(named('maker'));
  await maker.getByRole('button', { name: 'Come in' }).click();
  await expect(maker.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  // A fresh browser is a fresh dad, so this one is NOT the creator — the
  // same rule that makes every other prod spec invent its own names.
  const guest = await atTheDoor(browser);
  await guest.getByLabel('Code').fill(WORD);
  await guest.getByLabel('Your name').fill(named('guest2'));
  await guest.getByRole('button', { name: 'Come in' }).click();
  await expect(guest.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  await talk(guest);
  await guest.getByRole('button', { name: 'Menu' }).click();
  await guest
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Settings/ })
    .click();
  await expect(guest.getByTestId('rooms-owner')).toBeVisible();
  await expect(guest.getByTestId('room-week')).toBeDisabled();

  await maker.context().close();
  await guest.context().close();
});

test('the calendar picks a night, and it can be called off again', async ({ browser }) => {
  const page = await atTheDoor(browser);
  await page.getByLabel('Code').fill(WORD);
  await page.getByLabel('Your name').fill(named('picker'));
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  // A brand-new room has no night, so the sheet is the calendar.
  await page.getByTestId('dad-night').click();
  await expect(page.getByTestId('poll')).toBeVisible();

  const today = Number(new Date().getDate());
  if (today >= 28) await page.getByTestId('poll-next').click();
  const cell = page.getByTestId('poll-day').filter({ hasText: /^28$/ });
  await expect(cell).toBeEnabled();
  await cell.click();
  await page.getByTestId('poll-time').fill('20:30');
  await page.getByTestId('poll-lock').first().click();
  await expect(page.getByTestId('night-when')).toContainText('20:30', { timeout: 15_000 });

  // And the way out of it, which is the thing that was missing: armed once,
  // then the calendar is back.
  await page.getByTestId('night-call-off').click();
  await page.getByTestId('night-call-off').click();
  await expect(page.getByTestId('poll')).toBeVisible({ timeout: 15_000 });

  await page.context().close();
});
