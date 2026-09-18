import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CODE, comeIn, named, note, talk } from './names';

/**
 * The room itself, against the real Durable Object, D1 and R2.
 *
 * Nothing here is a fake: the websocket crosses the public internet, the
 * archive is the one the dads read, and the bytes go into the real bucket.
 */
test.describe.configure({ mode: 'serial' });

test('two dads see each other, and what each other says', async ({ browser }) => {
  const marc = await comeIn(browser, 'talker');
  const sam = await comeIn(browser, 'listener');

  await expect(marc.getByTestId('connection')).toContainText(/[2-9]|\d\d/);

  const said = note('a line');
  await marc.getByLabel('Say something').fill(said);
  await marc.getByRole('button', { name: 'Send' }).click();

  await expect(sam.getByTestId('line').filter({ hasText: said })).toBeVisible({ timeout: 15_000 });
  await expect(marc.getByTestId('line').filter({ hasText: said })).toBeVisible();

  // Typing reaches the other man and not the typist.
  await sam.getByLabel('Say something').fill('half a thought');
  await expect(marc.getByText(/typing/)).toBeVisible({ timeout: 10_000 });

  // And it survives a reload, because the archive is D1 and not the tab. A
  // reload lands on home, like every cold open does.
  await marc.reload();
  await expect(marc.getByTestId('connection')).toBeVisible({ timeout: 20_000 });
  await talk(marc);
  await expect(marc.getByTestId('line').filter({ hasText: said })).toBeVisible({ timeout: 20_000 });

  await marc.context().close();
  await sam.context().close();
});

test('a line is answered, changed and marked, against the real archive', async ({ browser }) => {
  // The newest half of the conversation, end to end on the deployment: the
  // reply columns from migration 0017 really are on the live database, the
  // marks table from 0014 really takes a row, and the room resolves the quote
  // out of its own tail rather than trusting the browser for it.
  const marc = await comeIn(browser, 'answered');
  const sam = await comeIn(browser, 'answerer');

  const asked = note('who has the cards');
  await marc.getByLabel('Say something').fill(asked);
  await marc.getByRole('button', { name: 'Send' }).click();
  // Once it has been answered, two rows hold these words: his own line and
  // the quote above the answer. The original is the one with no quote on it.
  const original = (page: Page) =>
    page
      .getByTestId('line')
      .filter({ hasText: asked })
      .filter({ hasNot: page.getByTestId('quote') });
  const his = original(sam);
  await expect(his).toBeVisible({ timeout: 15_000 });

  // An answer carries a snapshot of what it answers, cut by the room.
  await his.click({ button: 'right' });
  await sam.getByTestId('line-reply').click();
  const answer = note('I do, still in the car');
  await sam.getByLabel('Say something').fill(answer);
  await sam.getByRole('button', { name: 'Send' }).click();
  const answered = marc.getByTestId('line').filter({ hasText: answer });
  await expect(answered).toBeVisible({ timeout: 15_000 });
  await expect(answered.getByTestId('quote')).toContainText(asked);

  // A mark is one tap, and it reaches the other man.
  await his.dblclick();
  await expect(original(marc).getByTestId('mark')).toHaveText(/1/, { timeout: 15_000 });

  // And a man may change his own words, which the room answers with the line
  // itself: nothing here is optimistic.
  const fixed = note('who has the cards, actually');
  await original(marc).click({ button: 'right' });
  await marc.getByTestId('line-edit').click();
  await marc.getByLabel('Say something').fill(fixed);
  await marc.getByRole('button', { name: 'Send' }).click();
  const changed = sam.getByTestId('line').filter({ hasText: fixed });
  await expect(changed).toBeVisible({ timeout: 15_000 });
  await expect(changed.getByTestId('edited')).toBeVisible();
  await expect(marc.getByTestId('editing')).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('a photo goes up, renders inline, and is nobody else’s to read', async ({ browser }) => {
  const marc = await comeIn(browser, 'photographer');

  // A real 1x1 PNG, through the real upload path into the real bucket.
  const uploaded = await marc.evaluate(async () => {
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );
    const res = await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'X-Dads-Filename': 'prove.png' },
      body: bytes,
    });
    return { status: res.status, body: (await res.json()) as { media: { id: string } } };
  });
  expect(uploaded.status).toBe(200);
  const id = uploaded.body.media.id;

  // Served with its own type and no disposition — that is what "renders where
  // it lands" looks like — and privately cached.
  const served = await marc.request.get(`/api/media?id=${id}`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');
  expect(served.headers()['content-disposition']).toBeUndefined();
  expect(served.headers()['x-content-type-options']).toBe('nosniff');
  expect(served.headers()['cache-control']).toContain('private');

  // These are photographs of people's children: no session, no bytes.
  const stranger = await browser.newContext();
  const outside = await stranger.newPage();
  const refused = await outside.request.get(`/api/media?id=${id}`);
  expect(refused.status()).toBe(401);
  await stranger.close();

  // And an id that belongs to nothing is a 404, not a hint.
  const nothing = await marc.request.get('/api/media?id=med_notarealid');
  expect(nothing.status()).toBe(404);

  await marc.context().close();
});

test('an uploaded document cannot run on our own origin', async ({ browser }) => {
  const marc = await comeIn(browser, 'uploader');

  // The stored-XSS case: whatever the uploader calls it, anything off the
  // inline allowlist is stored and served as a download.
  for (const declared of ['text/html', 'image/svg+xml']) {
    const res = await marc.evaluate(async (type) => {
      const r = await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': type, 'X-Dads-Filename': 'prove.html' },
        body: new TextEncoder().encode('<script>alert(1)</script>'),
      });
      return { status: r.status, body: (await r.json()) as { media: { id: string } } };
    }, declared);
    expect(res.status).toBe(200);

    const served = await marc.request.get(`/api/media?id=${res.body.media.id}`);
    expect(served.headers()['content-type'], declared).toBe('application/octet-stream');
    expect(served.headers()['content-disposition'], declared).toContain('attachment');
  }

  await marc.context().close();
});

test('the call has a way through a strict NAT', async ({ browser }) => {
  const marc = await comeIn(browser, 'caller');

  // STUN unconditionally, TURN because the Realtime key is set in production.
  // This endpoint never errors by design, so the shape is the assertion.
  const ice = await marc.evaluate(async () => {
    const r = await fetch('/api/ice');
    return { status: r.status, body: (await r.json()) as { iceServers: { urls: string[] }[] } };
  });
  expect(ice.status).toBe(200);
  const urls = ice.body.iceServers.flatMap((s) => s.urls);
  expect(urls.some((u) => u.startsWith('stun:'))).toBe(true);
  expect(urls.some((u) => u.startsWith('turn:'))).toBe(true);

  await marc.context().close();
});

test('the reminder is on offer, which means the keys are really set', async ({ browser }) => {
  const marc = await comeIn(browser, 'reminded');
  // 503 here would mean the VAPID secrets are gone and the switch has quietly
  // stopped being offered — the failure mode nobody would report.
  const res = await marc.request.get('/api/push');
  expect(res.status()).toBe(200);
  expect((await res.json()).key).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  await marc.context().close();
});

test('a line typed with no signal is not lost', async ({ browser }) => {
  const context = await browser.newContext();

  // The dead spot: the socket stays open and swallows everything. Reproduced
  // by dropping the frames in the middle, because that is what a tunnel does
  // and what going offline does not.
  let swallow = false;
  await context.routeWebSocket('**/ws*', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (!swallow) server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });

  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(CODE);
  await page.getByLabel('Your name').fill(named('tunnel'));
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/, { timeout: 20_000 });
  await talk(page);

  swallow = true;
  const said = note('from a dead spot');
  await page.getByLabel('Say something').fill(said);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/waiting for a signal/)).toBeVisible();

  swallow = false;
  await expect(page.getByTestId('line').filter({ hasText: said })).toHaveCount(1, {
    timeout: 60_000,
  });
  await expect(page.getByText(/waiting for a signal/)).toHaveCount(0);

  await context.close();
});
