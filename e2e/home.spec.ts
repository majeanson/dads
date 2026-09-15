import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_HOME_GROUP } from './global-setup';
import { night, talk } from './talk';

/**
 * Where the app opens.
 *
 * Two things, and deliberately only two: the night — what this is and when it
 * is — and the conversation, which is what it is for, with who is about
 * underneath the way in because that is what decides whether to go in now.
 * Everything else is rows under the door on home, and behind the Menu
 * button once he is in.
 */
test.describe.configure({ mode: 'serial' });

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_HOME_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

test('the app opens on home, and the conversation is one tap away', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');

  // Through the door and onto home, not into the conversation.
  await expect(marc.getByTestId('home')).toBeVisible();
  await expect(marc.getByLabel('Say something')).toBeHidden();

  await marc.getByTestId('home-go').click();
  await expect(marc.getByLabel('Say something')).toBeVisible();
  await expect(marc.getByTestId('home')).toBeHidden();

  // And back, by the group's own name — where a logo goes in every app
  // anybody has ever used.
  await marc.getByTestId('go-home').click();
  await expect(marc.getByTestId('home')).toBeVisible();

  await marc.context().close();
});

test('home says when the night is, and takes his answer', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');

  // Set from the card itself: the night has no row of its own, on home or in
  // the conversation, because the card IS the night.
  await marc.getByTestId('dad-night').click();
  await marc.getByLabel('Day').selectOption('4');
  await marc.getByLabel('Time').fill('21:00');
  await marc.getByRole('button', { name: 'Save' }).click();
  await marc.getByRole('button', { name: 'Close', exact: true }).click();

  // Stacked, so the day and the hour are two lines rather than a sentence.
  const when = marc.getByTestId('home-when');
  await expect(when).toContainText('Thursday');
  await expect(when).toContainText('21:00');

  // Answering is on home rather than two taps into a sheet: who is coming is
  // the question that decides turnout.
  await marc.getByTestId('home-in').click();
  await expect(marc.getByTestId('home-who-coming')).toContainText('In: Marc');

  await marc.context().close();
});

test('the header counts who is about, and home counts what he has not read', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // Who is about is not on home any more — home asks one question, and that
  // is not it. The header counts them live, because the socket is open behind
  // both screens, and the count is the way into the roster. Read by NAME
  // rather than as a number: the 15s leave grace means a dad from the test
  // before this one can still be counted for a moment.
  await marc.getByTestId('connection').click();
  await expect(marc.getByTestId('here')).toContainText('Sam');
  await marc.getByRole('button', { name: 'Close', exact: true }).click();

  // Sam talks while Marc is standing on home. The way in says how many.
  // Counted as a CHANGE rather than an absolute: the room's own lines are
  // lines too, and an earlier test in this group set the night.
  const count = async () => {
    const mark = marc.getByTestId('home-new');
    if ((await mark.count()) === 0) return 0;
    return Number(/\d+/.exec((await mark.textContent()) ?? '')?.[0] ?? 1);
  };
  const before = await count();

  await talk(sam);
  await sam.getByLabel('Say something').fill('bedtime was a war tonight');
  await sam.getByRole('button', { name: 'Send' }).click();
  await expect.poll(count).toBe(before + 1);

  // And going in clears it.
  await marc.getByTestId('home-go').click();
  await expect(marc.getByTestId('line').filter({ hasText: 'bedtime was a war' })).toBeVisible();
  await marc.getByTestId('go-home').click();
  await expect(marc.getByTestId('home-new')).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('what he has already read is not announced again on the next open', async ({ browser }) => {
  const marc = await comeIn(browser, 'Reader');
  const sam = await comeIn(browser, 'Teller');

  await talk(sam);
  for (const line of ['one', 'two', 'three']) {
    await sam.getByLabel('Say something').fill(`something ${line}`);
    await sam.getByRole('button', { name: 'Send' }).click();
    await expect(sam.getByTestId('line').filter({ hasText: `something ${line}` })).toBeVisible();
  }

  // He reads them: into the conversation, at the bottom, tab in front of him.
  await marc.getByTestId('home-go').click();
  await expect(marc.getByTestId('line').filter({ hasText: 'something three' })).toBeVisible();
  await marc.getByTestId('go-home').click();
  await expect(marc.getByTestId('home-new')).toHaveCount(0);

  // And a cold open says nothing new, because it counts against what he has
  // read rather than tallying whatever the backfill happens to carry. That
  // tally began each load at nought, which announced the whole evening again.
  await marc.reload();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await expect(marc.getByTestId('home')).toBeVisible();
  await expect(marc.getByTestId('home-new')).toHaveCount(0);

  // A line said while he is on home still counts, and only that one.
  await sam.getByLabel('Say something').fill('and one more');
  await sam.getByRole('button', { name: 'Send' }).click();
  await expect(marc.getByTestId('home-new')).toContainText('1 new');

  await marc.context().close();
  await sam.context().close();
});

test('the way back is its own control, first in the header', async ({ browser }) => {
  const marc = await comeIn(browser, 'Ned');
  const sam = await comeIn(browser, 'Otto');

  // The way back is a control of its own, not the group's name.
  await marc.getByTestId('home-go').click();
  const back = marc.getByTestId('go-home');
  await expect(back).toBeVisible();
  await expect(back).toHaveAccessibleName('Home');
  const box = (await back.boundingBox())!;
  expect(box.height, 'a thumb has to be able to hit it').toBeGreaterThanOrEqual(36);
  await back.click();
  await expect(marc.getByTestId('home')).toBeVisible();

  await marc.context().close();
  await sam.context().close();
});

test('home keeps up with who is coming while he sits on it', async ({ browser }) => {
  const marc = await comeIn(browser, 'Pim');
  const sam = await comeIn(browser, 'Quill');

  // Marc stays on home. Sam goes and answers from the sheet.
  await expect(marc.getByTestId('home')).toBeVisible();
  await night(sam);
  await sam.getByTestId('rsvp-in').click();
  await expect(sam.getByTestId('rsvp-who')).toContainText('Quill');

  // Home is a live screen, so it must not go on showing a list the room has
  // already contradicted a foot below.
  await expect(marc.getByTestId('home-who-coming')).toContainText('Quill', { timeout: 10_000 });

  await marc.context().close();
  await sam.context().close();
});

test('he walks in on the divider, not at the top of the week', async ({ browser }) => {
  const marc = await comeIn(browser, 'Rune');
  const sam = await comeIn(browser, 'Sable');

  // A week's worth behind him, so that the top of the list and the divider
  // are nowhere near each other. With a short conversation both are on the
  // screen at once and the bug is invisible.
  await talk(sam);
  for (let i = 0; i < 25; i++) {
    // Padded, and that is not a decoration. A line's own text runs straight
    // into the clock beside it, so unpadded "…this 2" at 4:22 PM reads as
    // "…this 24:22 PM" and a substring match for "…this 24" finds two lines.
    // The suite passed all morning and broke after four o'clock.
    await sam.getByLabel('Say something').fill(`a week of this ${String(i).padStart(2, '0')}`);
    await sam.getByRole('button', { name: 'Send' }).click();
  }
  await expect(sam.getByTestId('line').filter({ hasText: 'a week of this 24' })).toBeVisible();

  // Marc reads everything, then goes back out to home.
  await marc.getByTestId('home-go').click();
  await expect(marc.getByTestId('line').filter({ hasText: 'a week of this 24' })).toBeVisible();
  await marc.getByTestId('go-home').click();
  await expect(marc.getByTestId('home-new')).toHaveCount(0);

  // A reload, because the boundary is where he got to BEFORE this sitting:
  // a device that has never opened the room has nothing to catch up on, by
  // design, so the divider only exists from the second visit.
  await marc.reload();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await expect(marc.getByTestId('home')).toBeVisible();

  // Sam talks while Marc is standing on home.
  for (const line of ['first', 'second', 'third']) {
    await sam.getByLabel('Say something').fill(`while he was out ${line}`);
    await sam.getByRole('button', { name: 'Send' }).click();
    await expect(sam.getByTestId('line').filter({ hasText: `out ${line}` })).toBeVisible();
  }
  await expect(marc.getByTestId('home-new')).toContainText('3 new');

  // And in. The divider effect used to fire behind home, where the stage is
  // display:none — the scroll went nowhere, the once-per-boundary guard was
  // spent, and `pinned` was turned off, so he arrived at the OLDEST line of
  // the backfill with nothing left to correct it.
  await marc.getByTestId('home-go').click();
  const since = marc.getByTestId('since');
  await expect(since).toBeVisible();
  await expect(since).toBeInViewport();

  await marc.context().close();
  await sam.context().close();
});

test('home carries the menu, and what is waiting is said on the row', async ({ browser }) => {
  const marc = await comeIn(browser, 'Barnaby');

  // The night, the door, and then the rest of the app as rows in what used
  // to be empty space — with no Menu button, because there is nothing left
  // for one to hide.
  await expect(marc.getByTestId('home-when')).toBeVisible();
  await expect(marc.getByTestId('home-go')).toBeVisible();
  await expect(marc.getByRole('navigation', { name: 'Rooms' })).toBeVisible();
  await expect(marc.getByRole('button', { name: 'Menu' })).toHaveCount(0);

  // A fresh dad has a week to fill in and a question to answer, and home says
  // so in words on the row it belongs to rather than as a dot.
  await expect(marc.getByTestId(/^mark-(board|prompts)$/).first()).toBeVisible();

  // In the conversation the rows are behind the Menu button, so the mark is
  // on the button — hiding it there would leave him no sign at all.
  await marc.getByTestId('home-go').click();
  await expect(marc.getByTestId('mark-menu')).toBeVisible();

  await marc.context().close();
});

test('home never says nobody has answered before it has asked', async ({ browser }) => {
  // The one thing on home that is fetched rather than pushed is who is
  // coming, and home paints before the answer lands. Nothing then is "I do
  // not know", and printing "Nobody has said yet" is the app inventing bad
  // news about turnout and correcting itself a second later.
  const context = await browser.newContext();
  const page = await context.newPage();
  // Held open and never answered, which is the state every cold open passes
  // through. Installed before the first navigation, which is when the route
  // has to exist.
  let asked = false;
  await page.route('**/api/night', () => {
    asked = true;
  });

  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_HOME_GROUP.code);
  await page.getByLabel('Your name').fill('Peregrine');
  await page.getByRole('button', { name: 'Come in' }).click();

  const coming = page.getByTestId('home-who-coming');
  await expect(coming).toBeVisible();
  await expect.poll(() => asked).toBe(true);
  await expect(coming).toHaveText('…');

  await context.close();

  // And once it HAS been answered, it says so. A fresh browser, because the
  // held request above cannot be handed back — and a fresh dad, because a new
  // context is a new member.
  const told = await comeIn(browser, 'Peregrine Two');
  await expect(told.getByTestId('home-who-coming')).not.toHaveText('…');
  await told.context().close();
});
