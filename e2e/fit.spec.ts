import { expect, test, type Page } from '@playwright/test';
import { E2E_FIT_GROUP } from './global-setup';

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

/** And past the right-hand edge, which `overflow-x: clip` on the room would
 * otherwise hide from everything but a dad's eyes. */
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
    ['the questions', () => rooms.getByRole('button', { name: /^Questions/ }).click()],
    ['the week', () => rooms.getByRole('button', { name: /^The week/ }).click()],
    ['settings', () => rooms.getByRole('button', { name: /^Settings/ }).click()],
    ['the invite', () => rooms.getByRole('button', { name: /^Invite a dad/ }).click()],
    ['dad night', () => page.getByTestId('dad-night').click()],
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
