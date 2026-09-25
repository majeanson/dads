import { expect, test } from '@playwright/test';
import { comeIn, home, named, note } from './names';

/**
 * The standing night, without moving it.
 *
 * This suite deliberately never changes the group's schedule — five people
 * actually turn up on it. Everything here is read, or is additive and swept up
 * by the teardown: an RSVP, a thing to get into.
 */
test.describe.configure({ mode: 'serial' });

/**
 * Whether this group has a night on the books.
 *
 * Read, never assumed — the same rule as the three switches. A room opened
 * yesterday has no night until somebody picks one, and a suite that demands
 * one would fail on the group's own state rather than on anything the
 * deployment got wrong. The tests that need an evening skip without one.
 */
async function hasNight(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(async () => {
    const r = await fetch('/api/me');
    if (!r.ok) return false;
    return ((await r.json()) as { group: { dadNight: unknown } }).group.dadNight !== null;
  });
}

test('the night reads the same on home, the header and the sheet', async ({ browser }) => {
  const marc = await comeIn(browser, 'nightreader');
  test.skip(!(await hasNight(marc)), 'this group has no night on the books');

  await expect(marc.getByTestId('night-soon')).toBeVisible();

  // And on home, where it is the largest thing on the screen and the header
  // does not repeat it.
  await marc.getByTestId('go-home').click();
  // The day over the hour, two lines, no "at" between them.
  await expect(marc.getByTestId('home-when')).toContainText(/\d\d:\d\d/);
  await expect(marc.getByTestId('night-soon')).toHaveCount(0);
  // The card is the night, and it carries its own way into the sheet.
  await marc.getByTestId('dad-night').click();
  await expect(marc.getByTestId('night-when')).toContainText(/at \d\d:\d\d/);

  await marc.context().close();
});

test('saying you are coming is said out loud, and can be taken back', async ({ browser }) => {
  const who = named('coming');
  const marc = await comeIn(browser, 'coming');
  test.skip(!(await hasNight(marc)), 'this group has no night on the books');
  const sam = await comeIn(browser, 'watching');

  await home(marc);
  await marc.getByTestId('dad-night').click();
  await marc.getByTestId('rsvp-in').click();
  await expect(marc.getByTestId('rsvp-who')).toContainText(who);

  // The other man finds out on the night's own screen, live over the real
  // socket. The room used to say it in a line; the conversation is what the
  // dads typed now, and the answer itself is better than a sentence about it.
  await home(sam);
  await sam.getByTestId('dad-night').click();
  await expect(sam.getByTestId('rsvp-who')).toContainText(who, { timeout: 15_000 });

  // Changing his mind rewrites the answer rather than adding to it.
  await marc.getByTestId('rsvp-out').click();
  await expect(marc.getByTestId('rsvp-who')).toContainText(new RegExp(`Can’t: .*${who}`));
  await expect(sam.getByTestId('rsvp-who')).toContainText(new RegExp(`Can’t: .*${who}`), {
    timeout: 15_000,
  });

  await marc.context().close();
  await sam.context().close();
});

test('what we should get into survives to the night, and is only its author’s to remove', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'asker');
  test.skip(!(await hasNight(marc)), 'this group has no night on the books');
  const sam = await comeIn(browser, 'reader');

  const thing = note('something to bring up');
  await home(marc);
  await marc.getByTestId('dad-night').click();
  await marc.getByLabel('Add', { exact: true }).fill(thing);
  await marc.getByRole('button', { name: 'Add', exact: true }).click();

  const mine = marc.getByTestId('agenda-item').filter({ hasText: thing });
  await expect(mine).toBeVisible();
  await expect(mine).toContainText(named('asker'));

  // Sam sees it on the sheet — which is where the things themselves are —
  // and cannot take it back.
  await home(sam);
  await sam.getByTestId('dad-night').click();
  const theirs = sam.getByTestId('agenda-item').filter({ hasText: thing });
  await expect(theirs).toBeVisible({ timeout: 15_000 });
  await expect(theirs.getByRole('button', { name: 'Take it back' })).toHaveCount(0);

  // The author can, and the server agrees.
  await mine.getByRole('button', { name: 'Take it back' }).click();
  await expect(marc.getByTestId('agenda-item').filter({ hasText: thing })).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('the night is a real calendar entry, repeating in the group’s own zone', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'calendar');
  test.skip(!(await hasNight(marc)), 'this group has no night on the books');

  const res = await marc.request.get('/api/night.ics');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');

  const ics = await res.text();
  // A slot with a rule, never an instant: 21:00 has to stay 21:00 across a
  // daylight-saving shift.
  expect(ics).toMatch(/DTSTART;TZID=[A-Za-z]+\/[A-Za-z_]+:\d{8}T\d{6}/);
  expect(ics).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)/);
  expect(ics).toContain('DURATION:PT3H');

  await marc.context().close();
});

test('the menu offers exactly what the group has switched on', async ({ browser }) => {
  const marc = await comeIn(browser, 'menureader');

  // Read the group's own state rather than assuming it. A suite that runs
  // against a live room has no business deciding what that room has open —
  // and asserting against it is the better test anyway: it proves the three
  // switches actually govern the menu.
  const rooms = await marc.evaluate(async () => {
    const r = await fetch('/api/me');
    return ((await r.json()) as { group: { rooms: Record<string, boolean> } }).group.rooms;
  });

  // In the conversation: everything. A man told mid-conversation that his
  // week is waiting had to walk back out to home to fill it in, which is why
  // this menu stopped being the talking rows alone.
  await marc.getByRole('button', { name: 'Menu' }).click();
  const chat = marc.getByRole('navigation', { name: 'Rooms' });
  await expect(chat.getByRole('button', { name: /^Questions/ })).toHaveCount(
    rooms.questions ? 1 : 0,
  );
  await expect(chat.getByRole('button', { name: /^The week/ })).toHaveCount(rooms.week ? 1 : 0);
  await expect(chat.getByRole('button', { name: /the table$/ })).toHaveCount(rooms.table ? 1 : 0);
  await expect(chat.getByRole('button', { name: /^Find something/ })).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Settings' })).toBeVisible();
  // Never a Dad night row: home's card is the night and carries its own way
  // in. And no invite row: bringing somebody in lives inside Settings.
  await expect(chat.getByRole('button', { name: /^Dad night/ })).toHaveCount(0);
  await expect(chat.getByRole('button', { name: 'Invite a dad' })).toHaveCount(0);
  await marc.getByRole('button', { name: 'Close', exact: true }).click();

  // On home: the night and the door, and Settings in the corner — no rows.
  await home(marc);
  await expect(marc.getByRole('navigation', { name: 'Rooms' })).toHaveCount(0);

  // These three are never behind a switch: the night, the way to change
  // anything, and inside that, the way to bring somebody in.
  await expect(marc.getByTestId('dad-night')).toBeVisible();
  await marc.getByTestId('home-settings').click();
  await expect(marc.getByTestId('settings-invite')).toBeVisible();

  await marc.context().close();
});

test('the day’s question, when the group is asking one', async ({ browser }) => {
  const marc = await comeIn(browser, 'answerer');
  const open = await marc.evaluate(async () => {
    const r = await fetch('/api/me');
    return ((await r.json()) as { group: { rooms: { questions: boolean } } }).group.rooms.questions;
  });
  test.skip(!open, 'the group has its questions switched off');

  const sam = await comeIn(browser, 'overhearing');
  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Questions/ })
    .click();

  const question = await marc.getByTestId('prompt-body').textContent();
  expect(question?.length).toBeGreaterThan(10);

  // The same question for everyone: one pool, one deterministic pick.
  await sam.getByRole('button', { name: 'Menu' }).click();
  await sam
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Questions/ })
    .click();
  expect(await sam.getByTestId('prompt-body').textContent()).toBe(question);

  await marc.context().close();
  await sam.context().close();
});
