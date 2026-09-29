import { expect, test, type Browser, type Page } from '@playwright/test';
import { menu, settings } from './talk';

/**
 * Leaving a room, and being taken out of one.
 *
 * Both need a room with a creator, which no seeded group has, so each test
 * opens its own at the door — from an address of its own, so it spends none
 * of the three rooms a day the new-room spec counts on.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);

async function openRoom(browser: Browser, name: string, word: string): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'CF-Connecting-IP': '10.9.9.11' },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('start-room').click();
  await page.getByLabel('What to call it').fill(name);
  await page.getByLabel('The word to get in').fill(word);
  await page.getByLabel('Your name').fill('Opener');
  await page.getByTestId('open-room').click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });
  return page;
}

async function comeIn(browser: Browser, word: string, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(word);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

test('the creator takes a dad out, and his screen goes to the door', async ({ browser }) => {
  const word = `depart remove ${run}`;
  const opener = await openRoom(browser, `Remove Room ${run}`, word);
  const sam = await comeIn(browser, word, 'Sam Removed');
  await expect(opener.getByTestId('connection')).toHaveText('2 here');

  await settings(opener);
  await opener.getByTestId('room-owning').click();
  await opener.getByTestId('remove-who').selectOption({ label: 'Sam Removed' });
  // Armed: the first press says who, the second does it.
  await opener.getByTestId('remove-do').click();
  await expect(opener.getByTestId('remove-do')).toContainText('Sam Removed');
  await opener.getByTestId('remove-do').click();
  // And it says what it could not do: the word still opens the door.
  await expect(opener.getByTestId('remove-done')).toContainText('Sam Removed is out');

  // Sam is at the door, told why, on the phone he was holding.
  await expect(sam.getByTestId('door-out')).toContainText(`Remove Room ${run}`);
  await expect(sam.getByLabel('Code')).toBeVisible();
  // And a reload does not put him back.
  await sam.reload();
  await expect(sam.getByLabel('Code')).toBeVisible();

  await expect(opener.getByTestId('connection')).toHaveText('1 here');
  await opener.context().close();
  await sam.context().close();
});

test('a dad leaves by himself; the creator hands it on first', async ({ browser }) => {
  const word = `depart leave ${run}`;
  const opener = await openRoom(browser, `Leave Room ${run}`, word);
  const sam = await comeIn(browser, word, 'Sam Leaving');

  // The creator cannot walk out on a room with somebody else in it.
  await menu(opener);
  await opener.getByTestId('menu-rooms').click();
  await expect(opener.getByTestId('rooms-leave-do')).toBeDisabled();

  await menu(sam);
  await sam.getByTestId('menu-rooms').click();
  await sam.getByTestId('rooms-leave-do').click();
  await expect(sam.getByTestId('rooms-leave-do')).toContainText(`Yes, leave Leave Room ${run}`);
  await sam.getByTestId('rooms-leave-do').click();
  // His only room: the door, and no "you're no longer in" — he knows.
  await expect(sam.getByLabel('Code')).toBeVisible();
  await expect(sam.getByTestId('door-out')).toHaveCount(0);

  await expect(opener.getByTestId('connection')).toHaveText('1 here');
  await opener.context().close();
  await sam.context().close();
});

test('a phone asleep when he was taken out finds the door when it wakes', async ({ browser }) => {
  // It never heard the `removed` frame — asleep, it was not there to — so
  // all it sees is its socket gone and the next one refused. Without asking
  // the session it would sit on "reconnecting" for ever. The frame is dropped
  // on its way to him here; going offline does not do it, because Chromium's
  // offline mode leaves an open websocket alone.
  const word = `depart asleep ${run}`;
  const opener = await openRoom(browser, `Asleep Room ${run}`, word);

  const context = await browser.newContext();
  await context.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((frame) => {
      if (typeof frame === 'string' && frame.includes('"t":"removed"')) return;
      ws.send(frame);
    });
  });
  const sam = await context.newPage();
  await sam.goto('/');
  await sam.getByLabel('Code').fill(word);
  await sam.getByLabel('Your name').fill('Sam Asleep');
  await sam.getByRole('button', { name: 'Come in' }).click();
  await expect(opener.getByTestId('connection')).toHaveText('2 here');

  await settings(opener);
  await opener.getByTestId('room-owning').click();
  await opener.getByTestId('remove-who').selectOption({ label: 'Sam Asleep' });
  await opener.getByTestId('remove-do').click();
  await opener.getByTestId('remove-do').click();
  await expect(opener.getByTestId('remove-done')).toBeVisible();

  await expect(sam.getByTestId('door-out')).toContainText(`Asleep Room ${run}`, {
    timeout: 30_000,
  });

  await opener.context().close();
  await context.close();
});
