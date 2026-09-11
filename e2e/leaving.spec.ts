import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_LEAVE_GROUP } from './global-setup';

// One group, one roster.
test.describe.configure({ mode: 'serial' });

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_LEAVE_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

/**
 * What happens to everyone else the moment a dad goes.
 *
 * The room must not go on claiming he is there. Nobody reloads a chat app to
 * find out who is in it, and a count that lies is worse than no count.
 */
test('a dad closing his tab leaves the room, visibly and at once', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  await expect(marc.getByTestId('connection')).toHaveText('2 here');

  await sam.context().close();

  // No reload, no waiting for the 15s grace: the roster is the sockets that
  // are actually attached, and the count follows them.
  await expect(marc.getByTestId('connection')).toHaveText('1 here', { timeout: 5_000 });

  await marc.context().close();
});

test('a dad who drops off the call takes his tile and his audio with him', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  await marc.getByRole('button', { name: 'Join the call' }).click();
  await sam.getByRole('button', { name: 'Join the call' }).click();
  await expect(marc.getByTestId('call')).toContainText('2 on the call');

  await sam.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(marc.getByTestId('call-tile').filter({ hasText: 'Sam' })).toBeVisible({
    timeout: 20_000,
  });

  // Not "Leave" — the phone in a tunnel, the tab closed mid-sentence.
  await sam.context().close();

  await expect(marc.getByTestId('call')).toContainText('just you so far', { timeout: 5_000 });
  await expect(marc.getByTestId('call-tile').filter({ hasText: 'Sam' })).toHaveCount(0);
  // And nothing is left playing his sound into an empty room.
  expect(await marc.evaluate(() => document.querySelectorAll('audio').length)).toBe(0);

  await marc.context().close();
});

test('and the room remembers he was here, without saying so in the conversation', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');
  await expect(marc.getByTestId('connection')).toHaveText('2 here');
  await sam.context().close();
  await expect(marc.getByTestId('connection')).toHaveText('1 here', { timeout: 5_000 });

  // The leave lands after the grace window, in the one place it belongs.
  // Named exactly: earlier tests in this file have been in and out of the same
  // group, so "Sam" alone matches a column of rows.
  await marc.getByTestId('connection').click();
  await marc.getByTestId('comings').click();
  await expect(marc.getByTestId('coming').filter({ hasText: 'Sam left' }).first()).toBeVisible({
    timeout: 30_000,
  });
  await marc.getByRole('button', { name: 'Close', exact: true }).click();

  // And nowhere else: coming and going is not conversation.
  await expect(marc.getByTestId('line').filter({ hasText: 'Sam' })).toHaveCount(0);

  await marc.context().close();
});
