import { expect, type Browser, type Page } from '@playwright/test';
import { devVar } from './devvars';

/**
 * The word of the room this suite writes into: `PROD_CODE`, from the
 * environment or from the gitignored `.dev.vars`, and nowhere else.
 *
 * A default here would be a live secret in a public repository, and a word
 * this app can never show — it is kept as a PBKDF2 hash — has no business
 * being written down beside the tests that use it. The room is one made for
 * this suite (2026-09-25, "The Prove Room", slug `prove-room`, opened with
 * `group:create --remote`): it used to write into the room the real dads
 * use, which is why the word had to be typed every run as friction. With a
 * room of its own there is nobody to disturb, and the word can live where
 * the ops secret already does.
 */
export const CODE = (() => {
  const code = devVar('PROD_CODE');
  if (!code) {
    throw new Error(
      "PROD_CODE is not set: put the prove room's word in .dev.vars, or in the environment.",
    );
  }
  return code;
})();

/**
 * Every dad this suite invents is named with this prefix, and the teardown
 * deletes exactly those.
 *
 * A fresh browser context is a fresh member — that is how identity works here
 * — so a suite like this leaves a trail of people behind it unless somebody
 * sweeps up. The prefix is the sweeping instruction.
 */
export const MARK = 'prove-';

/**
 * A suffix that is different every run.
 *
 * Without it the second run reads the first one's announcements: "prove-coming
 * is in." is written by the ROOM, not by him, so it has no member to delete it
 * by — and the room's own supersede rule then collapses this run's answer into
 * last run's. Unique names make every run's lines its own.
 */
const RUN = Math.random().toString(36).slice(2, 6);

export function named(what: string): string {
  return `${MARK}${what}-${RUN}`;
}

/**
 * Anything this suite SAYS carries the marker too, not just anyone it invents.
 *
 * The sweep is a body match, and the first version of this used "prove:" for
 * lines and "prove-" for names — so four lines stayed in the dads' room after
 * a run that reported itself clean. One marker, everywhere.
 */
export function note(what: string): string {
  return `${MARK}${what} ${Date.now()}`;
}

/** A new dad in the prove room. */
export async function comeIn(browser: Browser, what: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(CODE);
  await page.getByLabel('Your name').fill(named(what));
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });
  // The app opens on home; almost everything this suite checks is inside.
  await talk(page);
  return page;
}

/**
 * Into the conversation, from wherever he is.
 *
 * The app opens on home — when the night is, and the way in — and the
 * conversation is one tap past it. Idempotent, because these suites walk
 * through several screens and it must not matter whether the last step left
 * him on home or already inside.
 *
 * It waits for the room to BE there before deciding. An immediate
 * `isVisible()` is false for a screen that is about to paint, and the helper
 * then quietly did nothing — leaving the caller asserting against a
 * conversation still behind `display: none`.
 *
 * Which screen is showing is read off `data-view` rather than off a control
 * with a name: a dad can read this room in French, and a helper that waits for
 * "Say something" waits for ever in a room that says "Dis quelque chose".
 */
export async function talk(page: Page): Promise<void> {
  const room = page.locator('main.room');
  await expect(room).toBeVisible();
  if ((await room.getAttribute('data-view')) === 'home') {
    await page.getByTestId('home-go').click();
  }
  await expect(room).toHaveAttribute('data-view', 'talk');
}

/** Back to home, from wherever he is. Idempotent, like `talk`. */
export async function home(page: Page): Promise<void> {
  const room = page.locator('main.room');
  await expect(room).toBeVisible();
  if ((await room.getAttribute('data-view')) === 'talk') {
    await page.getByTestId('go-home').click();
  }
  await expect(room).toHaveAttribute('data-view', 'home');
}
