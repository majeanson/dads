import type { Page } from '@playwright/test';

/**
 * Into the conversation, from wherever he is.
 *
 * The app opens on home now — when the night is, who is about, what is
 * waiting — and the conversation is one tap past it. Idempotent on purpose:
 * most of these suites walk through several screens and it must not matter
 * whether a given step left him on home or already inside.
 */
export async function talk(page: Page): Promise<void> {
  const go = page.getByTestId('home-go');
  if (await go.isVisible()) await go.click();
}
