import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_CALL_GROUP } from './global-setup';

// One group, one call.
test.describe.configure({ mode: 'serial' });

/**
 * The voice mesh, with Chrome's fake devices. What can be checked here is
 * everything up to and including a real peer connection reaching `connected`
 * between two browsers — which is the part that actually breaks. Whether a
 * human can hear a human is not something a headless browser can answer.
 */
async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://jaffre.marcportal.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><h1>table</h1>' }),
  );
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_CALL_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

test('two dads join the call and actually connect', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  await marc.getByRole('button', { name: 'Join the call' }).click();
  await expect(marc.getByTestId('call')).toContainText('just you so far');

  await sam.getByRole('button', { name: 'Join the call' }).click();

  // Each sees the other on the call — that is the room's signalling working.
  await expect(marc.getByTestId('call')).toContainText('2 on the call');
  await expect(sam.getByTestId('call')).toContainText('2 on the call');

  // And a peer connection really came up, which is the part that breaks.
  await expect
    .poll(
      () =>
        marc.evaluate(() => (document.querySelectorAll('audio').length > 0 ? 'has-audio' : 'none')),
      { timeout: 20_000 },
    )
    .toBe('has-audio');

  // Mute is a track that stops sending, not a connection that goes away.
  await marc.getByRole('button', { name: 'Mute' }).click();
  await expect(marc.getByRole('button', { name: 'Unmute' })).toBeVisible();
  await expect(sam.getByTestId('call')).toContainText('2 on the call');

  // Leaving takes you off the others' call too.
  await marc.getByRole('button', { name: 'Leave' }).click();
  await expect(marc.getByRole('button', { name: 'Join the call' })).toBeVisible();
  await expect(sam.getByTestId('call')).toContainText('just you so far');

  await marc.context().close();
  await sam.context().close();
});

test('the call survives a reload without stranding anyone', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  await marc.getByRole('button', { name: 'Join the call' }).click();
  await expect(marc.getByTestId('call')).toContainText('just you so far');

  // A reload drops the socket; the room must not think he is still on it.
  await marc.reload();
  await expect(marc.getByRole('button', { name: 'Join the call' })).toBeVisible();

  await marc.context().close();
});

test('a camera turned on reaches the other dad, and turning it off takes it away', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  await marc.getByRole('button', { name: 'Join the call' }).click();
  await sam.getByRole('button', { name: 'Join the call' }).click();
  await expect(marc.getByTestId('call')).toContainText('2 on the call');
  await expect(sam.getByTestId('call')).toContainText('2 on the call');

  // Nobody is showing anything yet: sound is the point, pictures are optional.
  await expect(sam.getByTestId('call-tile')).toHaveCount(0);

  // Adding a track has to renegotiate, and the offer comes from whichever
  // side added it — the reason this is perfect negotiation and not one-sided
  // offers. Before that fix this assertion was the one that failed.
  await marc.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(marc.getByTestId('call-tile').filter({ hasText: 'You' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(sam.getByTestId('call-tile').filter({ hasText: 'Marc' })).toBeVisible({
    timeout: 20_000,
  });

  // Sam is still only heard, not seen.
  await expect(marc.getByTestId('call-tile').filter({ hasText: 'Sam' })).toHaveCount(0);
  await expect(marc.getByTestId('call')).toContainText('Sam');

  // Off again, and the picture goes away without the call going with it.
  await marc.getByRole('button', { name: 'Camera off' }).click();
  await expect(sam.getByTestId('call-tile')).toHaveCount(0, { timeout: 20_000 });
  await expect(sam.getByTestId('call')).toContainText('2 on the call');

  await marc.context().close();
  await sam.context().close();
});
