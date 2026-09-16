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
const LAPTOP = { width: 1280, height: 800 };

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

for (const [label, viewport] of [
  ['the small phone', SMALL],
  ['a laptop', LAPTOP],
] as const) {
  test(`home fits ${label} without scrolling`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await comeIn(page, `Fit ${label}`);
    // Let the fonts and the night land before measuring.
    await page.waitForTimeout(300);
    expect(await overflow(page, '.home')).toBe(0);
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
