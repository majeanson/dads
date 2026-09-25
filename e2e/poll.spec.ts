import { expect, test, type Page } from '@playwright/test';
import { E2E_POLL_GROUP } from './global-setup';
import { home, night, talk } from './talk';

// One group, one calendar: these would mark each other's days in parallel.
test.describe.configure({ mode: 'serial' });

async function comeIn(browser: import('@playwright/test').Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_POLL_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

/**
 * A day in the month showing that is definitely not in the past.
 *
 * The 28th: every month has one, and the calendar opens on the month the
 * group is standing in — so on the 29th of a month this pages forward once
 * and takes the 28th of the next one. Nothing in these tests depends on
 * WHICH day it is, only that everybody is marking the same one.
 */
async function futureDay(page: Page): Promise<string> {
  const today = Number(new Date().getDate());
  if (today >= 28) await page.getByTestId('poll-next').click();
  const cell = page.getByTestId('poll-day').filter({ hasText: /^28$/ });
  await expect(cell).toBeEnabled();
  return (await cell.getAttribute('data-day'))!;
}

/**
 * Nothing on the books, whatever the last test left.
 *
 * This file is serial and shares one group, so a test that needs the calendar
 * has to clear the night the test before it arranged. The two shapes come off
 * in different ways, which is the feature rather than an inconvenience: an
 * evening arranged for a date is CALLED OFF, and a standing night is cleared
 * from the form that sets it.
 */
async function startFromNothing(page: Page): Promise<void> {
  await night(page);
  // Wait for the sheet's body before asking what is in it. Its code can
  // arrive a moment after the sheet opens, and an instant `isVisible()` then
  // saw neither shape and cleared nothing.
  await expect(page.getByTestId('night').or(page.getByTestId('poll')).first()).toBeVisible();
  if (await page.getByTestId('night-call-off').isVisible()) {
    await page.getByTestId('night-call-off').click();
    await page.getByTestId('night-call-off').click();
  } else if (await page.getByTestId('night-when').isVisible()) {
    await page.getByTestId('night-standing').click();
    await page.getByRole('button', { name: 'Clear' }).click();
  }
  await expect(page.getByTestId('poll')).toBeVisible({ timeout: 15_000 });
}

test('with nothing on the books, home asks when the next one is', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  await home(marc);

  // The card keeps its shape and its size: a group with no night has the same
  // question as a group with one, and it is a louder question, not a quieter.
  await expect(marc.getByTestId('home')).toContainText('When’s the next one?');
  await expect(marc.getByTestId('home-poll-none')).toBeVisible();
  // And the one button on it goes to the calendar, not to a form.
  await marc.getByTestId('dad-night').click();
  await expect(marc.getByTestId('poll')).toBeVisible();
  await expect(marc.getByTestId('poll-nobody')).toBeVisible();

  await marc.context().close();
});

test('a tap says yes, another says maybe, another says no, another takes it off', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'Marc');
  await night(marc);
  const day = await futureDay(marc);
  const mine = marc.locator(`[data-testid="poll-day"][data-day="${day}"]`);
  await expect(mine).toHaveAttribute('data-mine', 'none');

  await mine.click();
  await expect(mine).toHaveAttribute('data-mine', 'in');
  // Once anybody can do a day it is worth putting up, by name.
  await expect(marc.getByTestId('poll-best').filter({ hasText: 'Marc' })).toBeVisible();

  await mine.click();
  await expect(mine).toHaveAttribute('data-mine', 'maybe');

  await mine.click();
  await expect(mine).toHaveAttribute('data-mine', 'out');

  // Round to nothing said, which is a different thing from "can't".
  await mine.click();
  await expect(mine).toHaveAttribute('data-mine', 'none');
  await expect(marc.getByTestId('poll-nobody')).toBeVisible();

  await marc.context().close();
});

test('the calendar is shared, and any dad locks the day in', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Picker');
  const sam = await comeIn(browser, 'Sam Picker');

  await night(marc);
  const day = await futureDay(marc);
  await marc.locator(`[data-testid="poll-day"][data-day="${day}"]`).click();

  // Sam is looking at his own screen and finds out without a reload: the room
  // pokes every open socket, and the calendar re-reads.
  await night(sam);
  const his = sam.locator(`[data-testid="poll-day"][data-day="${day}"]`);
  await expect(his).toBeVisible();
  await expect(sam.getByTestId('poll-best').filter({ hasText: 'Marc Picker' })).toBeVisible({
    timeout: 15_000,
  });
  await his.click();
  await expect(his).toHaveAttribute('data-mine', 'in');

  // Any dad, no admin: Sam locks in the day Marc put up.
  await sam.getByTestId('poll-time').fill('20:30');
  await sam.getByTestId('poll-lock').first().click();

  // It is the night now, on both screens, and the room said who did it.
  await expect(sam.getByTestId('night-when')).toContainText('20:30');
  await sam.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sam.getByTestId('home-when')).toContainText('20:30');

  // Marc's screen has the date too, without a reload and without being told
  // in a sentence: the night itself reaches every open phone, and home is
  // where a man looks for when the next one is.
  await marc.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(marc.getByTestId('home-when')).toContainText('20:30', { timeout: 15_000 });

  // And the conversation carries none of it.
  await talk(marc);
  await expect(marc.getByTestId('line')).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('a night can be made to happen once, and then it is the calendar again', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'Marc Once');
  await startFromNothing(marc);

  // A standing night first, so there is something to turn off.
  await marc.getByTestId('night-standing').click();
  // Exact, always: Playwright matches an accessible name by SUBSTRING, and
  // both the repeat switch ("Always the same day") and every cell in the
  // calendar ("Thursday, September 10 — …") contain the word "day".
  await marc.getByLabel('Day', { exact: true }).selectOption('4');
  await marc.getByLabel('Time', { exact: true }).fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();
  await expect(marc.getByTestId('night-when')).toContainText('Thursdays');

  // Off: this evening still happens, pinned to the date it was already going
  // to fall on — and the sheet says what happens after it.
  await marc.getByTestId('night-repeat').click();
  await expect(marc.getByTestId('night-when')).not.toContainText('Thursdays');
  await expect(marc.getByTestId('night')).toContainText('pick the next one at the end');

  // Home shows which Thursday, which a standing night never needs to say.
  await marc.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(marc.getByTestId('home-date')).toBeVisible();

  // Back on: a standing night again, and the date goes with it.
  await marc.getByTestId('dad-night').click();
  await marc.getByTestId('night-repeat').click();
  await expect(marc.getByTestId('night-when')).toContainText('Thursdays');
  await marc.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(marc.getByTestId('home-date')).toHaveCount(0);

  await marc.context().close();
});

test('there are three answers now, and the third is maybe', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Maybe');

  // Its own night rather than the one the test above happens to leave: a test
  // that only passes when the whole file runs is a test that fails the first
  // time anybody tries to run it on its own.
  await night(marc);
  await marc.getByTestId('night-standing').click();
  await marc.getByLabel('Day', { exact: true }).selectOption('4');
  await marc.getByLabel('Time', { exact: true }).fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();
  await expect(marc.getByTestId('night-when')).toContainText('Thursdays');
  await marc.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(marc.getByTestId('home-when')).toBeVisible();

  await marc.getByTestId('home-maybe').click();
  await expect(marc.getByTestId('home-who-coming')).toContainText('Might: Marc Maybe');
  // All three stay on the screen, with the one he gave filled in: pressing a
  // different one is how a man changes his mind, not a toggle that cycles.
  await expect(marc.getByTestId('home-maybe')).toHaveAttribute('data-mine', 'yes');
  await expect(marc.getByTestId('home-in')).toHaveAttribute('data-mine', 'no');

  // Changing his mind rewrites the answer rather than adding to it, which is
  // what the card shows and what the room is spared: a man who said he might
  // and then that he is coming has not said two things.
  await marc.getByTestId('home-in').click();
  await expect(marc.getByTestId('home-who-coming')).toContainText('In: Marc Maybe');
  await expect(marc.getByTestId('home-who-coming')).not.toContainText('Might:');

  await talk(marc);
  await expect(marc.getByTestId('line')).toHaveCount(0);

  await marc.context().close();
});

test('a date that was locked in can be moved, and called off', async ({ browser }) => {
  // The dead end this closes: an evening pinned to a date could be turned
  // into a standing weekly night or wiped from a form about something else,
  // and neither is what a man means by "I can't do Thursday any more". Until
  // the date had been and gone, the group was stuck with it.
  const marc = await comeIn(browser, 'Marc Mover');

  await startFromNothing(marc);
  const day = await futureDay(marc);
  await marc.locator(`[data-testid="poll-day"][data-day="${day}"]`).click();
  await marc.getByTestId('poll-time').fill('21:00');
  await marc.getByTestId('poll-lock').first().click();
  await expect(marc.getByTestId('night-when')).toContainText('21:00');

  // MOVED: the editor offers the date itself, not a weekday dropdown that
  // cannot say "the 28th" — and what comes back is still one evening.
  await marc.getByTestId('night-standing').click();
  const field = marc.getByTestId('night-date');
  await expect(field).toHaveValue(day);
  const moved = `${day.slice(0, 8)}${String(Number(day.slice(8)) === 28 ? 27 : 28).padStart(2, '0')}`;
  await field.fill(moved);
  await marc.getByRole('button', { name: 'Save' }).click();
  await expect(marc.getByTestId('night-when')).toBeVisible();
  // Still an arranged evening: the way out of one is still on the screen.
  await expect(marc.getByTestId('night-call-off')).toBeVisible();

  // CALLED OFF: armed once, because four other men arranged their week
  // around it, and then the calendar is back in the same sheet.
  await marc.getByTestId('night-call-off').click();
  await marc.getByTestId('night-call-off').click();
  await expect(marc.getByTestId('poll')).toBeVisible({ timeout: 15_000 });
  await expect(marc.getByTestId('night-when')).toHaveCount(0);

  // Nothing is said about it in the conversation. The state is the news:
  // home asks when the next one is, which is the question that follows.
  await marc.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(marc.getByTestId('home-poll-none')).toBeVisible({ timeout: 15_000 });
  await talk(marc);
  await expect(marc.getByTestId('line')).toHaveCount(0);

  await marc.context().close();
});
