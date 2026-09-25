import { expect, test, type Browser, type Page } from '@playwright/test';
import { menu, talk } from './talk';

/**
 * Opening a room from the door, and what the man who opened it owns.
 *
 * No fixture group here on purpose: this suite makes its own room, which is
 * the whole point of it. It makes exactly ONE, and every other test leans on
 * that one — because opening a room is rate-limited to three per address per
 * day and locally every request comes from the same address. A spec that
 * spent the budget would pass alone and fail in company, which is the worst
 * way for a test to be wrong. `global-setup` clears the bucket at the start
 * of each run, so a second run in the same day is not the second three.
 */
test.describe.configure({ mode: 'serial' });

/** Unique per run: the join word is UNIQUE across every room in the database,
 * and yesterday's run left its rooms behind. */
const WORD = `e2e own room ${Math.random().toString(36).slice(2, 8)}`;
const ROOM = 'The Tuesday Lot';

async function atTheDoor(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  return page;
}

/** The rooms are on home's own screen and behind the Menu button in the
 * conversation, so `menu()` is what knows which. */
const openSettings = async (page: Page) => {
  await menu(page);
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Settings/ })
    .click();
};

test('a room is opened, shared, and its switches belong to the man who opened it', async ({
  browser,
}) => {
  const maker = await atTheDoor(browser);

  // The door asks the one question almost everybody comes to answer, and
  // making a room is the line underneath it.
  await expect(maker.getByLabel('Code')).toBeVisible();
  await maker.getByTestId('start-room').click();

  await maker.getByLabel('What to call it').fill(ROOM);
  await maker.getByLabel('The word to get in').fill(WORD);
  await maker.getByLabel('Your name').fill('Marc Founder');
  await maker.getByTestId('open-room').click();

  // He is in — no second trip through the door with the word he just chose.
  await expect(maker.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });
  await expect(maker.getByRole('heading', { name: ROOM })).toBeVisible();

  // Somebody he sent the word to, on a different device entirely.
  const guest = await atTheDoor(browser);
  await guest.getByLabel('Code').fill(WORD);
  await guest.getByLabel('Your name').fill('Sam Guest');
  await guest.getByRole('button', { name: 'Come in' }).click();
  await expect(guest.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });
  await expect(guest.getByRole('heading', { name: ROOM })).toBeVisible();

  // Two men in one room, which is the only proof that matters.
  await expect(maker.getByTestId('connection')).toHaveText('2 here', { timeout: 20_000 });
  await talk(maker);
  await talk(guest);
  await maker.getByLabel('Say something').fill('first one in');
  await maker.getByRole('button', { name: 'Send' }).click();
  await expect(guest.getByTestId('line').filter({ hasText: 'first one in' })).toBeVisible();

  // The switches are the creator's: the line says so, and one answers him.
  await openSettings(maker);
  await expect(maker.getByTestId('rooms-owner')).toContainText('The word');
  await maker.getByTestId('room-questions').click();
  await expect(maker.getByTestId('room-questions')).not.toBeChecked();
  await maker.getByRole('button', { name: 'Close', exact: true }).click();

  // And not the guest's: the line names whose they are, and his cannot move.
  await openSettings(guest);
  await expect(guest.getByTestId('rooms-owner')).toContainText('Marc Founder');
  await expect(guest.getByTestId('room-week')).toBeDisabled();

  await maker.context().close();
  await guest.context().close();
});

test('a word another room already has is refused, with words', async ({ browser }) => {
  const page = await atTheDoor(browser);
  await page.getByTestId('start-room').click();
  await page.getByLabel('What to call it').fill('Second Here');
  await page.getByLabel('The word to get in').fill(WORD);
  await page.getByLabel('Your name').fill('Sam Second');
  await page.getByTestId('open-room').click();

  // Two rooms behind one word would put a dad who typed the right thing into
  // a room full of strangers, so the second is not made — and he is told
  // why, rather than left looking at a form that did nothing. A refusal
  // costs no room, so this spends none of the day's three.
  await expect(page.getByRole('alert')).toContainText('already uses that word');
  await expect(page.getByTestId('connection')).toHaveCount(0);
  await page.context().close();
});

test('a word too short to be worth anything is refused at the door', async ({ browser }) => {
  const page = await atTheDoor(browser);
  await page.getByTestId('start-room').click();
  await page.getByLabel('What to call it').fill('Too Easy');
  await page.getByLabel('The word to get in').fill('ab');
  await page.getByLabel('Your name').fill('Marc Short');
  await page.getByTestId('open-room').click();
  await expect(page.getByRole('alert')).toContainText('too short');
  await page.context().close();
});

test('a dad who followed an invite link is never asked to open a room', async ({ browser }) => {
  // He has already been let into somebody's room by whoever sent the link;
  // offering him a form for making his own is the door answering a question
  // he did not ask.
  const page = await atTheDoor(browser);
  await expect(page.getByTestId('start-room')).toBeVisible();
  await page.goto(`/i/${'x'.repeat(40)}`);
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByTestId('start-room')).toHaveCount(0);
  await page.context().close();
});

test('the creator changes the word, then hands the room on', async ({ browser }) => {
  // Owning the switches without these two was half a feature: a word that got
  // out could be changed by nobody in the room, and a creator who drifted
  // away left the other four frozen for ever.
  const first = `e2e handed ${Math.random().toString(36).slice(2, 8)}`;
  const second = `${first} again`;

  const maker = await atTheDoor(browser);
  await maker.getByTestId('start-room').click();
  await maker.getByLabel('What to call it').fill('The Handover');
  await maker.getByLabel('The word to get in').fill(first);
  await maker.getByLabel('Your name').fill('Marc Handing');
  await maker.getByTestId('open-room').click();
  await expect(maker.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  // The word: never shown, only replaced.
  await openSettings(maker);
  await maker.getByTestId('room-owning').click();
  await expect(maker.getByTestId('room-word')).toHaveValue('');
  await maker.getByTestId('room-word').fill(second);
  await maker.getByRole('button', { name: 'Change it' }).click();
  await expect(maker.getByTestId('room-word-done')).toBeVisible({ timeout: 15_000 });
  await maker.getByRole('button', { name: 'Close', exact: true }).click();

  // The new one opens it; the old one opens nothing.
  const guest = await atTheDoor(browser);
  await guest.getByLabel('Code').fill(first);
  await guest.getByLabel('Your name').fill('Sam Handed');
  await guest.getByRole('button', { name: 'Come in' }).click();
  await expect(guest.getByRole('alert')).toBeVisible();
  await guest.getByLabel('Code').fill(second);
  await guest.getByRole('button', { name: 'Come in' }).click();
  await expect(guest.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  // Handing it over, armed once because it cannot be undone from this side.
  await openSettings(maker);
  await maker.getByTestId('room-owning').click();
  await maker.getByTestId('hand-to').selectOption({ label: 'Sam Handed' });
  await maker.getByTestId('hand-over').click();
  await maker.getByTestId('hand-over').click();

  // It is Sam's room now: his switches move and Marc's have gone from his
  // screen altogether.
  await openSettings(guest);
  await expect(guest.getByTestId('rooms-owner')).toContainText('The word');
  await guest.getByTestId('room-week').click();
  await expect(guest.getByTestId('room-week')).not.toBeChecked();

  await maker.context().close();
  await guest.context().close();
});

test('one phone, two rooms, and a way between them', async ({ browser }) => {
  // The device token is looked up per group, so joining a second room never
  // cost him the first — but without its word written down somewhere there
  // was no way back, and nothing in the app said which rooms he was in.
  const word = `e2e second ${Math.random().toString(36).slice(2, 8)}`;
  const page = await atTheDoor(browser);

  // He is in the room this file opened at the top; now he opens another on
  // the same phone.
  await page.getByLabel('Code').fill(WORD);
  await page.getByLabel('Your name').fill('Marc Two');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByRole('heading', { name: ROOM })).toBeVisible({ timeout: 20_000 });

  // In the conversation, where the full menu is: home holds the short one,
  // and a fifth row there puts the door off the bottom of a small phone. The
  // row is there with ONE room too, because it is also the only way to get
  // another — a man already inside cannot reach the door.
  await talk(page);
  await menu(page);
  await page.getByTestId('menu-rooms').click();
  await expect(page.getByTestId('my-room')).toHaveCount(1);

  await page.getByTestId('rooms-start').click();
  await page.getByLabel('What to call it').fill('The Second Lot');
  await page.getByLabel('The word to get in').fill(word);
  await page.getByLabel('Your name').fill('Marc Elsewhere');
  await page.getByTestId('open-room').click();
  await expect(page.getByRole('heading', { name: 'The Second Lot' })).toBeVisible({
    timeout: 20_000,
  });

  // Now there are two, and the row carries the count. Back into the
  // conversation first: opening a room lands him on home, like any arrival.
  await talk(page);
  await menu(page);
  await expect(page.getByTestId('menu-rooms')).toContainText('2');
  await page.getByTestId('menu-rooms').click();
  await expect(page.getByTestId('my-rooms')).toBeVisible();
  const rows = page.getByTestId('my-room');
  await expect(rows).toHaveCount(2);
  // The one he is standing in says so; the other says what he is called there.
  await expect(rows.filter({ hasText: 'The Second Lot' })).toHaveAttribute('data-current', 'yes');
  await expect(rows.filter({ hasText: ROOM })).toContainText('Marc Two');

  // And going back needs no word.
  await rows.filter({ hasText: ROOM }).click();
  await expect(page.getByRole('heading', { name: ROOM })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('connection')).toHaveText(/here$/);

  await page.context().close();
});
