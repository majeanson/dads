import { expect, type Page } from '@playwright/test';

/**
 * Into the conversation, from wherever he is.
 *
 * The app opens on home — when the night is, and the way in — and the
 * conversation is one tap past it. Idempotent on purpose: most of these suites
 * walk through several screens and it must not matter whether a given step
 * left him on home or already inside.
 *
 * It waits for the room to BE there before deciding, rather than asking
 * whether the way in is visible this instant: after a reload the app is still
 * booting, an immediate `isVisible()` is false for a screen that is about to
 * paint, and the helper then quietly did nothing — leaving the caller
 * asserting against a conversation still behind `display: none`.
 *
 * Which screen is showing is read off `data-view` rather than off a control
 * with a name. A dad can read this room in French, and a helper that waits for
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

/**
 * To the menu, from wherever he is.
 *
 * The rows live only behind the conversation's Menu button (2026-09-25:
 * home holds the night, the way in and Settings in its corner), so this
 * steps in first. The `Rooms` navigation is there afterwards, which is what
 * a caller should scope its next click to.
 */
export async function menu(page: Page): Promise<void> {
  await talk(page);
  await page.getByRole('button', { name: 'Menu' }).click();
}

/** Settings, from home's corner. */
export async function settings(page: Page): Promise<void> {
  await home(page);
  await page.getByTestId('home-settings').click();
}

/** The invite, which lives inside Settings. */
export async function invite(page: Page): Promise<void> {
  await settings(page);
  await page.getByTestId('settings-invite').click();
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

/**
 * Into the night sheet. The night lives on home's card and nowhere else —
 * there is no menu row for it on either screen — so this goes home first.
 */
export async function night(page: Page): Promise<void> {
  await home(page);
  await page.getByTestId('dad-night').click();
}
