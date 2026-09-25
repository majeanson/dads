import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_FIT_GROUP } from './global-setup';
import { home, menu } from './talk';

// One group, one night: the last test here clears it to reach the calendar,
// and every other test in the file sets one.
test.describe.configure({ mode: 'serial' });

/**
 * Home never scrolls, and neither does a sheet that can help it.
 *
 * Every size on home is a clamp on the screen's height, set against a
 * measured budget with about ten pixels to spare on the smallest phone. That
 * is a number a future change to one padding will quietly eat, and nothing
 * else in the suite would notice: a screen that scrolls by twelve pixels
 * passes every behavioural test there is. So this one measures.
 *
 * The small phone is the iPhone SE from the home screen, which is the tight
 * case; the laptop is where home goes two-column and the sheets are panels.
 */
const SMALL = { width: 390, height: 667 };
/** The narrowest phone anybody still carries. 390 is the design target, but
 * a row that fits 390 and not 360 is a row half of Android cannot read. */
const NARROW = { width: 360, height: 740 };
const LAPTOP = { width: 1280, height: 800 };
/** A browser window on a laptop, not maximised: where the two columns first
 * ran past the page edge, because a bare 1fr cannot shrink below its rows. */
const WINDOW = { width: 940, height: 540 };

async function comeIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_FIT_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  // With a night on the card, which is its tallest shape.
  await page.evaluate(() =>
    fetch('/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ night: { weekday: 4, time: '21:00', tz: 'America/Montreal' } }),
    }),
  );
  await expect(page.getByTestId('home-when')).toBeVisible();
}

/** Pixels of content past the bottom of the box: nought is the only pass. */
function overflow(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`${sel}: not on the page`);
    return Math.max(0, el.scrollHeight - el.clientHeight);
  }, selector);
}

/**
 * Anything hanging off either edge of the SCREEN, named and measured.
 *
 * `scrollWidth` is no use for this on its own: `overflow-x: clip` on the room
 * makes a box's own scrollWidth equal its clientWidth however far its contents
 * reach, so a card twelve pixels wider than the phone reports itself content.
 * This asks the viewport instead, which cannot be told not to look.
 */
function past(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`${sel}: not on the page`);
    const box = el.getBoundingClientRect();
    const out: string[] = [];
    if (box.right > window.innerWidth + 1) {
      out.push(`${sel}: ${Math.round(box.right - window.innerWidth)}px past the right`);
    }
    if (box.left < -1) out.push(`${sel}: ${Math.round(-box.left)}px past the left`);
    return out;
  }, selector);
}

/** And past the right-hand edge of its own box. */
function sideways(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`${sel}: not on the page`);
    return Math.max(0, el.scrollWidth - el.clientWidth);
  }, selector);
}

for (const [label, viewport] of [
  ['the small phone', SMALL],
  ['a laptop', LAPTOP],
  ['a laptop window', WINDOW],
] as const) {
  test(`home fits ${label} without scrolling`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await comeIn(page, `Fit ${label}`);
    // Let the fonts and the night land before measuring.
    await page.waitForTimeout(300);
    expect(await overflow(page, '.home')).toBe(0);
    expect(await sideways(page, '.home')).toBe(0);
    expect(await sideways(page, 'main.room')).toBe(0);
    await context.close();
  });
}

test('every sheet fits the small phone without scrolling', async ({ browser }) => {
  const context = await browser.newContext({ viewport: SMALL });
  const page = await context.newPage();
  await comeIn(page, 'Fit sheets');
  const rooms = page.getByRole('navigation', { name: 'Rooms' });
  const close = () => page.getByRole('button', { name: 'Close', exact: true }).first().click();
  // The sheet's scrolling area is the content under its header.
  const content = '[role="dialog"] > div:last-child';

  const scenes: [string, () => Promise<void>][] = [
    [
      'the questions',
      async () => {
        await menu(page);
        await rooms.getByRole('button', { name: /^Questions/ }).click();
      },
    ],
    [
      'the week',
      async () => {
        await menu(page);
        await rooms.getByRole('button', { name: /^The week/ }).click();
      },
    ],
    [
      'settings',
      async () => {
        await home(page);
        await page.getByTestId('home-settings').click();
      },
    ],
    [
      'the invite',
      async () => {
        await home(page);
        await page.getByTestId('home-settings').click();
        await page.getByTestId('settings-invite').click();
      },
    ],
    [
      'dad night',
      async () => {
        await home(page);
        await page.getByTestId('dad-night').click();
      },
    ],
  ];
  const over: string[] = [];
  for (const [scene, open] of scenes) {
    await open();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(300);
    const px = await overflow(page, content);
    if (px > 0) over.push(`${scene}: ${px}px past the bottom`);
    await close();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  expect(over).toEqual([]);
  await context.close();
});

/** A dad in the fit group, on the narrowest phone, reading in French. */
async function narrow(browser: Browser, name: string) {
  const context = await browser.newContext({ viewport: NARROW });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await page.getByLabel('Code').fill(E2E_FIT_GROUP.code);
  await page.getByLabel('Ton nom').fill(name);
  await page.getByRole('button', { name: 'Entre' }).click();
  await expect(page.getByTestId('connection')).toBeVisible();
  return { context, page };
}

test('the menu fits a narrow phone in French, with both marks on it', async ({ browser }) => {
  // A dad who has just arrived has a question he has not answered and a week
  // he has not filled in, so both rows carry their mark — and a mark is the
  // longest a row ever gets. In French, on a 360px phone, that row made the
  // whole nav wider than the sheet it sits in: a menu row never wraps, and
  // an implicit grid column takes the width of its widest child.
  const { context, page } = await narrow(browser, 'Fit Menu');
  await page.getByTestId('home-go').click();
  await page.getByRole('button', { name: 'Menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Rooms' });
  await expect(nav).toBeVisible();
  // The marks really are on it: without them this proves nothing.
  await expect(page.getByTestId('mark-prompts')).toBeVisible();
  await expect(page.getByTestId('mark-board')).toBeVisible();
  await page.waitForTimeout(200);

  expect(await sideways(page, '.menu')).toBe(0);
  expect(await sideways(page, '[role="dialog"] > div:last-child')).toBe(0);
  expect(await sideways(page, 'html')).toBe(0);

  await context.close();
});

test('the questions fit a narrow phone in French, history and all', async ({ browser }) => {
  // The row that says what was asked before carries the COUNT of it, and in
  // French it is the longest row in the app: "Ce qui a été demandé avant" and
  // a number beside it. A button never wraps, so a row too long for the
  // screen does not wrap either — it makes its grid wider than the sheet, and
  // takes the form above it off the right-hand edge with it. A group that has
  // never been asked anything has no count and never shows this, which is why
  // the fixture has three days behind it.
  const context = await browser.newContext({ viewport: NARROW });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await page.getByLabel('Code').fill(E2E_FIT_GROUP.code);
  await page.getByLabel('Ton nom').fill('Fit Étroit');
  await page.getByRole('button', { name: 'Entre' }).click();
  await expect(page.getByTestId('connection')).toBeVisible();
  await page.getByTestId('home-go').click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Les questions/ })
    .click();
  await page.getByTestId('prompt-body').waitFor();
  await page.waitForTimeout(300);

  // The count really is on the row: without it this test proves nothing.
  await expect(page.getByTestId('prompt-history')).toContainText(/[0-9]/);
  expect(await sideways(page, '[role="dialog"] > div:last-child')).toBe(0);
  expect(await sideways(page, 'html')).toBe(0);
  const row = await page.getByTestId('prompt-history').boundingBox();
  expect(row!.x + row!.width).toBeLessThanOrEqual(NARROW.width);

  await context.close();
});

test('the three answers fit a narrow phone in French', async ({ browser }) => {
  // "Je suis là · Peut-être · Je peux pas", three across a card on a 360px
  // phone. A button never wraps and the columns are `minmax(0, 1fr)`, so an
  // answer too long for its share does not widen the card — it is cut, and
  // nothing else in the suite would notice a man being asked "Je peux pa".
  const { context, page } = await narrow(browser, 'Fit Answers');
  await page.evaluate(() =>
    fetch('/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ night: { weekday: 4, time: '21:00', tz: 'America/Montreal' } }),
    }),
  );
  await expect(page.getByTestId('home-when')).toBeVisible();
  await page.waitForTimeout(200);

  for (const id of ['home-in', 'home-maybe', 'home-out']) {
    const cut = await page.getByTestId(id).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect({ id, cut }).toEqual({ id, cut: 0 });
  }
  expect(await sideways(page, '.home-answers')).toBe(0);
  // And measured against the SCREEN, not against `main.room`: the room is
  // `overflow-x: clip`, which makes its own scrollWidth equal its clientWidth
  // whatever is hanging off the side of it. A box that says it does not
  // overflow because it was told not to look proves nothing.
  expect(await past(page, '.home-answers')).toEqual([]);
  expect(await past(page, '.home-card')).toEqual([]);

  await context.close();
});

test('home fits the small phone with a full table and the night days away', async ({ browser }) => {
  // "Full table" shares the countdown's line, so the news costs no height —
  // when there IS a countdown. Further than three days out there is none,
  // and a row of its own put home past the bottom of this phone, for exactly
  // the group the line is about: four in, on a Sunday, for Thursday. The
  // fit above never had an RSVP on it, so it could not see this.
  const context = await browser.newContext({ viewport: SMALL });
  const page = await context.newPage();
  await comeIn(page, 'Fit Full');
  const weekday = (new Date().getDay() + 5) % 7;
  await page.evaluate(
    (weekday) =>
      fetch('/api/night', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ night: { weekday, time: '21:00', tz: 'America/Montreal' } }),
      }),
    weekday,
  );
  await expect(page.getByTestId('home-when')).toBeVisible();
  await expect(page.getByTestId('home-away')).toHaveCount(0);

  const seated = [];
  for (const name of ['Al', 'Bo', 'Cy', 'Di']) {
    const other = await browser.newContext();
    const res = await other.request.post('/api/join', {
      data: { code: E2E_FIT_GROUP.code, displayName: name },
    });
    expect(res.ok()).toBe(true);
    expect((await other.request.put('/api/rsvp', { data: { answer: 'in' } })).ok()).toBe(true);
    seated.push(other);
  }
  await expect(page.getByTestId('home-full')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('home-away')).toHaveCount(0);
  await page.waitForTimeout(300);

  expect(await overflow(page, '.home')).toBe(0);
  expect(await past(page, '.home-card')).toEqual([]);

  for (const other of seated) await other.close();
  await context.close();
});

test('the night sheet’s three answers share one row on the small phone', async ({ browser }) => {
  // The same control as home's card. Three separate buttons wrapped
  // two-and-one on a 390px phone, in both languages, which read as broken
  // under a card that had just shown the same question as one row.
  const context = await browser.newContext({ viewport: SMALL });
  const page = await context.newPage();
  await comeIn(page, 'Fit Sheet Answers');
  await page.getByTestId('dad-night').click();
  await expect(page.getByTestId('rsvp-out')).toBeVisible();
  await page.waitForTimeout(200);
  const rows = await Promise.all(
    ['rsvp-in', 'rsvp-maybe', 'rsvp-out'].map(async (id) => {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(SMALL.width);
      return Math.round(box.y);
    }),
  );
  expect(rows).toEqual([rows[0], rows[0], rows[0]]);
  await context.close();
});

test('the creator’s settings fit the small phone', async ({ browser }) => {
  // Only the man who opened the room sees the word and the handover, and the
  // rest of this file signs in as a joined dad — so Settings fit the phone
  // for everybody except him. Its own address, so opening a room here does
  // not count against the three a day the new-room spec spends.
  const context = await browser.newContext({
    viewport: SMALL,
    extraHTTPHeaders: { 'CF-Connecting-IP': '10.9.9.9' },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('start-room').click();
  await page.getByLabel('What to call it').fill('The Fit Owner');
  await page.getByLabel('The word to get in').fill(`fit owner ${Date.now().toString(36)}`);
  await page.getByLabel('Your name').fill('Fit Owner');
  await page.getByTestId('open-room').click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });

  await page.getByTestId('home-settings').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // It really is the creator's sheet: the row that holds the two forms.
  await expect(page.getByTestId('room-owning')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await overflow(page, '[role="dialog"] > div:last-child')).toBe(0);

  // And the forms are still one press away.
  await page.getByTestId('room-owning').click();
  await expect(page.getByTestId('room-word')).toBeVisible();
  await context.close();
});

test('the glasses fitter fits a narrow phone in French', async ({ browser }) => {
  // The fitter is a popover thirteen rems wide, and its two buttons never
  // wrap: "Remets-les au milieu" beside "Enregistre" hung fifty pixels past
  // its edge. English fit by six pixels, which is why nobody saw it.
  const { context, page } = await narrow(browser, 'Fit Lunettes');
  await page.getByTestId('home-go').click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Réglages/ })
    .click();
  await page.setInputFiles('#face', 'public/icon-192.png');
  await page.getByTestId('glasses-open').click();
  await page.getByTestId('glasses-fit').click({ timeout: 15_000 });
  const fitter = page.getByTestId('glasses-fitter');
  await expect(fitter).toBeVisible();
  await page.waitForTimeout(200);

  expect(await past(page, '[data-testid="glasses-fitter"]')).toEqual([]);
  const box = (await fitter.boundingBox())!;
  for (const id of ['fit-save', 'fit-area', 'fit-size']) {
    const inside = (await page.getByTestId(id).boundingBox())!;
    expect({
      id,
      over: Math.max(0, Math.round(inside.x + inside.width - box.x - box.width)),
    }).toEqual({ id, over: 0 });
  }
  await context.close();
});

test('the calendar fits a narrow phone in French', async ({ browser }) => {
  // A month grid is the tallest thing in the app that is not a list, and this
  // is the state every group lands in: nothing on the books, nothing marked.
  // It has to fit without scrolling, because the question it asks is at the
  // top and the answer is at the bottom. Once dads have marked days the
  // shortlist under it may push past the fold, which is what a sheet's
  // scrolling content area is for.
  const { context, page } = await narrow(browser, 'Fit Calendar');
  // Every other test in this file sets a night on the shared group, and with
  // one on the books the sheet is the night rather than the calendar. Hence
  // the serial mode above: this clears it, and runs last.
  await page.evaluate(() =>
    fetch('/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ night: null }),
    }),
  );
  await expect(page.getByTestId('home-when')).toHaveCount(0);
  await page.getByTestId('dad-night').click();
  await expect(page.getByTestId('poll')).toBeVisible();
  await page.waitForTimeout(300);

  const content = '[role="dialog"] > div:last-child';
  expect({ down: await overflow(page, content) }).toEqual({ down: 0 });
  expect(await sideways(page, '.cal')).toBe(0);
  expect(await sideways(page, content)).toBe(0);
  // The grid and the row under it, against the screen itself. A `<Button>`
  // never wraps, so "La même soirée chaque semaine" in an implicit `auto`
  // grid column made the whole sheet wider than the phone — and the calendar
  // went with it, off the right-hand edge where nobody could reach Saturday.
  expect(await past(page, '.cal')).toEqual([]);
  expect(await past(page, '[data-testid="night-standing"]')).toEqual([]);

  await context.close();
});

test('home fits the small phone in French asking when the next one is', async ({ browser }) => {
  // With no night, the card lists the two days the most dads can do, one to
  // a line, each a calendar leaf with the faces of who can. "C'est quand la
  // prochaine ?" wraps to two lines in French, so this is the card at its
  // tallest. Runs after the calendar test, which cleared the night.
  const context = await browser.newContext({ viewport: SMALL });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await page.getByLabel('Code').fill(E2E_FIT_GROUP.code);
  await page.getByLabel('Ton nom').fill('Fit Prochaine');
  await page.getByRole('button', { name: 'Entre' }).click();
  await expect(page.getByTestId('connection')).toBeVisible();
  await page.evaluate(() =>
    fetch('/api/night', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ night: null }),
    }),
  );
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const voters = [];
  for (const [name, answer] of [
    ['Ann', 'in'],
    ['Bea', 'in'],
    ['Cat', 'maybe'],
  ] as const) {
    const other = await browser.newContext();
    await other.request.post('/api/join', {
      data: { code: E2E_FIT_GROUP.code, displayName: name },
    });
    await other.request.put('/api/poll', { data: { day: day(4), answer: 'in' } });
    await other.request.put('/api/poll', { data: { day: day(6), answer } });
    voters.push(other);
  }
  await page.reload();
  const best = page.getByTestId('home-poll-best');
  await expect(best).toBeVisible({ timeout: 15_000 });
  await expect(best.locator('li')).toHaveCount(2);
  await page.waitForTimeout(300);

  expect(await overflow(page, '.home')).toBe(0);
  expect(await past(page, '.home-card')).toEqual([]);

  for (const other of voters) await other.close();
  await context.close();
});
