import { expect, type Browser, type Page } from '@playwright/test';

/**
 * The code the real group uses. Changing it means changing this, which is the
 * right amount of friction: a suite that writes into a live room should not be
 * runnable by accident.
 */
export const CODE = process.env.PROD_CODE ?? 'daddy';

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

/** A new dad in the real room. */
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
 * The app opens on home — when the night is, who is about, what is waiting —
 * and the conversation is one tap past it. Idempotent, because these suites
 * walk through several screens and it must not matter whether the last step
 * left him on home or already inside.
 */
export async function talk(page: Page): Promise<void> {
  const go = page.getByTestId('home-go');
  if (await go.isVisible()) await go.click();
}
