import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { talk } from './talk';
import { E2E_CALL_GROUP } from './global-setup';

// One group, one call.
test.describe.configure({ mode: 'serial' });

/**
 * The voice mesh, with Chrome's fake devices. What can be checked here is
 * everything up to and including a real peer connection reaching `connected`
 * between two browsers — which is the part that actually breaks. Whether a
 * human can hear a human is not something a headless browser can answer.
 */
async function comeIn(browser: Browser, name: string, phone = false): Promise<Page> {
  // A phone: a coarse pointer and a phone's screen. The fake camera comes from
  // the browser's launch flags, so it is there in this context too.
  const context = await browser.newContext(
    phone ? { ...devices['iPhone 13'], permissions: ['microphone', 'camera'] } : {},
  );
  const page = await context.newPage();
  await page.route('https://jaffre.marcportal.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><h1>table</h1>' }),
  );
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_CALL_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
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

  // Leaving takes you off the others' call too. The call's own row: the
  // header's phone is called "Leave" too while he is on it.
  await marc.getByTestId('call').getByRole('button', { name: 'Leave' }).click();
  await expect(marc.getByRole('button', { name: 'Join the call' })).toBeVisible();
  await expect(sam.getByTestId('call')).toContainText('just you so far');

  await marc.context().close();
  await sam.context().close();
});

test('a call that is on shows in the header, with how many, on home too', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');
  await expect(sam.getByTestId('call-live')).toHaveCount(0);

  await marc.getByRole('button', { name: 'Join the call' }).click();
  await expect(sam.getByTestId('call-live')).toContainText('1');

  // And from home, where nothing else would say so.
  await sam.getByTestId('go-home').click();
  await expect(sam.getByTestId('call-live')).toContainText('1');

  await marc.getByTestId('call').getByRole('button', { name: 'Leave' }).click();
  await expect(sam.getByTestId('call-live')).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('the call survives a reload without stranding anyone', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  await marc.getByRole('button', { name: 'Join the call' }).click();
  await expect(marc.getByTestId('call')).toContainText('just you so far');

  // A reload drops the socket; the room must not think he is still on it.
  // It lands on home, and the way into the call is beside the talk.
  await marc.reload();
  await talk(marc);
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

  // Off again, and the picture goes away without the call going with it.
  await marc.getByRole('button', { name: 'Camera off' }).click();
  await expect(sam.getByTestId('call-tile')).toHaveCount(0, { timeout: 20_000 });
  await expect(sam.getByTestId('call')).toContainText('2 on the call');

  await marc.context().close();
  await sam.context().close();
});

test('a dad can enlarge a tile, and knows who is muted', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  await marc.getByRole('button', { name: 'Join the call' }).click();
  await sam.getByRole('button', { name: 'Join the call' }).click();
  await expect(marc.getByTestId('call')).toContainText('2 on the call');

  await sam.getByRole('button', { name: 'Camera', exact: true }).click();
  const tile = marc.getByTestId('call-tile').filter({ hasText: 'Sam' });
  await expect(tile).toBeVisible({ timeout: 20_000 });

  // Tap the man to see the man, and tap him again to put him back.
  await tile.getByRole('button').click();
  await expect(tile).toHaveAttribute('data-big', 'yes');
  await tile.getByRole('button').click();
  await expect(tile).not.toHaveAttribute('data-big', 'yes');

  // Sam mutes himself. From Marc's end a muted man and a quiet one are the
  // same thing on the wire, so the room has to say which.
  await sam.getByRole('button', { name: 'Camera off' }).click();
  await expect(marc.getByTestId('call-tile')).toHaveCount(0, { timeout: 20_000 });
  await sam.getByRole('button', { name: 'Mute' }).click();

  // The names and the mute marks live behind the count, in who's here —
  // not in a row under the call buttons.
  await marc.getByTestId('call-count').click();
  const samHere = marc.getByTestId('roster-entry').filter({ hasText: 'Sam' });
  await expect(samHere).toHaveAttribute('data-on-call', 'yes');
  await expect(samHere).toContainText('muted', { timeout: 10_000 });

  await sam.getByRole('button', { name: 'Unmute' }).click();
  await expect(samHere).not.toContainText('muted', { timeout: 10_000 });

  await marc.context().close();
  await sam.context().close();
});

test('a dad on a phone turns his camera round, and the call carries on', async ({ browser }) => {
  // Marc, 2026-11-01: a dad wants to show the room what is in front of him,
  // not his face. Chrome's fake camera may well ignore which way it is asked
  // to face; what this proves is that the picture was swapped for a new one
  // without the call dropping, not which lens it came from.
  const marc = await comeIn(browser, 'Marc Turns', true);
  const sam = await comeIn(browser, 'Sam Watches');

  await marc.getByRole('button', { name: 'Join the call' }).click();
  await sam.getByRole('button', { name: 'Join the call' }).click();
  await expect(marc.getByTestId('call')).toContainText('2 on the call');
  await expect(sam.getByTestId('call')).toContainText('2 on the call');

  // No switch before there is a camera to switch.
  await expect(marc.getByTestId('call-switch')).toHaveCount(0);
  await marc.getByRole('button', { name: 'Camera', exact: true }).click();
  const switchIt = marc.getByTestId('call-switch');
  await expect(switchIt).toHaveAccessibleName('Switch camera');

  const call = marc.getByTestId('call');
  const self = marc.getByTestId('call-tile').filter({ hasText: 'You' }).locator('video');
  const seen = sam.getByTestId('call-tile').filter({ hasText: 'Marc Turns' });
  await expect(call).toHaveAttribute('data-facing', 'user');
  // His own face, mirrored, the way every front camera shows it.
  await expect(self).toHaveCSS('scale', /^-1/);
  await expect(seen).toBeVisible({ timeout: 20_000 });

  const trackId = () =>
    self.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0]?.id);
  const before = await trackId();

  await switchIt.click();
  await expect(call).toHaveAttribute('data-facing', 'environment');
  // A new picture, in the same place: the old track is gone from his stream.
  await expect.poll(trackId).not.toBe(before);
  // What the back camera sees is the right way round.
  await expect(self).toHaveCSS('scale', 'none');
  // And his own preview is still moving, not frozen on the last frame.
  const at = await self.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect
    .poll(() => self.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(at);

  // Sam still sees him, and nobody left the call over it.
  await expect(seen).toBeVisible();
  await expect(sam.getByTestId('call')).toContainText('2 on the call');
  await expect(call).toContainText('2 on the call');

  // And back to his face.
  await switchIt.click();
  await expect(call).toHaveAttribute('data-facing', 'user');
  await expect(self).toHaveCSS('scale', /^-1/);
  await expect(seen).toBeVisible();
  await expect(sam.getByTestId('call')).toContainText('2 on the call');

  await marc.context().close();
  await sam.context().close();
});

test('the phone in the header hangs up while he is on the call', async ({ browser }) => {
  // Marc, 2026-11-01: on the call, the header's phone is the way out.
  const marc = await comeIn(browser, 'Marc Hangs Up');
  const sam = await comeIn(browser, 'Sam Stays On');

  await marc.getByRole('button', { name: 'Join the call' }).click();
  await sam.getByRole('button', { name: 'Join the call' }).click();
  await expect(marc.getByTestId('call')).toContainText('2 on the call');

  const hangUp = marc.getByTestId('call-hangup');
  await expect(hangUp).toBeVisible();
  // Named for what it does, then the count a sighted dad reads beside the
  // phone, the way the chip says it.
  await expect(hangUp).toHaveAccessibleName('Leave — 2 on the call');
  // Sam is on the call too, so his header's phone hangs up as well.
  await expect(sam.getByTestId('call-hangup')).toBeVisible();

  await hangUp.click();
  await expect(marc.getByTestId('call')).toHaveCount(0);
  await expect(hangUp).toHaveCount(0);
  await expect(sam.getByTestId('call')).toContainText('just you so far');
  // The header is the way in again: the chip, since Sam is still on it.
  await expect(marc.getByRole('button', { name: 'Join the call' })).toBeVisible();
  await expect(marc.getByTestId('call-live')).toContainText('1');

  await marc.context().close();
  await sam.context().close();
});
