import { readFileSync } from 'node:fs';
import {
  devices,
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import { talk } from './talk';
import { E2E_ROOM_GROUP } from './global-setup';

// One room, one roster: these tests would see each other's dads if they ran
// at the same time.
test.describe.configure({ mode: 'serial' });

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
  return page;
}

test('two dads see each other and each other’s lines', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // The count is on the room; the names are behind it, because on most
  // evenings knowing that two dads are here is the whole question.
  await expect(marc.getByTestId('connection')).toHaveText('2 here');
  await marc.getByTestId('connection').click();
  await expect(marc.getByTestId('roster-entry')).toHaveCount(2);

  // Coming and going is recorded there — behind one more tap, because the
  // roster is the question and the log is the detail — and NOT in the
  // conversation.
  await marc.getByTestId('comings').click();
  await expect(marc.getByTestId('coming').filter({ hasText: 'Sam came in' })).toBeVisible();
  await marc.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(marc.getByTestId('line').filter({ hasText: 'came in' })).toHaveCount(0);

  await marc.getByLabel('Say something').fill('rough bedtime tonight');
  await marc.getByRole('button', { name: 'Send' }).click();

  await expect(sam.getByTestId('line').filter({ hasText: 'rough bedtime tonight' })).toBeVisible();
  await expect(marc.getByTestId('line').filter({ hasText: 'rough bedtime tonight' })).toBeVisible();
  await expect(marc.getByLabel('Say something')).toHaveValue('');
  // Still his: pressing Send did not take the keyboard away. On a phone that
  // is the difference between a conversation and a form.
  await expect(marc.getByLabel('Say something')).toBeFocused();

  await sam.getByLabel('Say something').fill('same here, twice');
  await sam.getByLabel('Say something').press('Enter');
  await expect(marc.getByTestId('line').filter({ hasText: 'same here, twice' })).toBeVisible();

  await marc.context().close();
  await sam.context().close();
});

test('a dad who reloads keeps the evening’s lines', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  await marc.getByLabel('Say something').fill('before the reload');
  await marc.getByLabel('Say something').press('Enter');
  await expect(marc.getByTestId('line').filter({ hasText: 'before the reload' })).toBeVisible();

  await marc.reload();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await talk(marc);
  await expect(marc.getByTestId('line').filter({ hasText: 'before the reload' })).toBeVisible();

  await marc.context().close();
});

test('a dad sends a photo and the others see it', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // A real PNG, handed to the picker the way a phone hands one over.
  await marc.setInputFiles('#attach', {
    name: 'pool.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });

  // It waits for a caption rather than firing the moment it is picked.
  await expect(marc.getByTestId('pending-media')).toContainText('pool.png');
  await marc.getByLabel('Say something').fill('he finally jumped in');
  await marc.getByRole('button', { name: 'Send' }).click();

  const line = sam.getByTestId('line').filter({ hasText: 'he finally jumped in' });
  await expect(line).toBeVisible();
  const image = line.locator('img');
  await expect(image).toBeVisible();
  // The bytes really arrive: a broken image has no natural width.
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // And the composer is clear again.
  await expect(marc.getByTestId('pending-media')).toHaveCount(0);
  await expect(marc.getByLabel('Say something')).toHaveValue('');

  await marc.context().close();
  await sam.context().close();
});

test('a line typed with no signal waits, and goes when the signal comes back', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const marcCtx = await browser.newContext();

  /**
   * A dead spot, not a disconnection.
   *
   * The socket a phone leaves behind in a tunnel stays readyState OPEN and
   * swallows everything sent down it — nothing closes, nothing throws, and the
   * app is told nothing. That is the case worth testing, and setOffline does
   * not reproduce it, so the frames are dropped in the middle instead.
   */
  let swallow = false;
  await marcCtx.routeWebSocket('**/ws*', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (!swallow) server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });

  const marc = await marcCtx.newPage();
  await marc.goto('/');
  await marc.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await marc.getByLabel('Your name').fill('Fitz');
  await marc.getByRole('button', { name: 'Come in' }).click();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await talk(marc);

  const sam = await comeIn(browser, 'Gil');

  swallow = true;

  // He can still type, and pressing send is accepted rather than swallowed by
  // the app as well as by the network.
  await marc.getByLabel('Say something').fill('on the train, back later');
  await marc.getByRole('button', { name: 'Send' }).click();
  await expect(marc.getByLabel('Say something')).toHaveValue('');
  await expect(marc.getByText(/waiting for a signal/)).toBeVisible();
  // It is nowhere near the room: nothing that was sent got there.
  await expect(sam.getByTestId('line').filter({ hasText: 'on the train' })).toHaveCount(0);

  // The signal comes back. The socket that was lying about being open is
  // dropped on its own, and what was held goes down the new one.
  swallow = false;
  await expect(
    marc.getByTestId('line').filter({ hasText: 'on the train, back later' }),
  ).toBeVisible({ timeout: 45_000 });
  // Once, not twice: the room recognises a line it has already posted.
  await expect(sam.getByTestId('line').filter({ hasText: 'on the train, back later' })).toHaveCount(
    1,
  );
  await expect(marc.getByText(/waiting for a signal/)).toHaveCount(0);

  await marcCtx.close();
  await sam.context().close();
});

test('several lines typed in a dead spot arrive in order, once each', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  let swallow = false;
  await context.routeWebSocket('**/ws*', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (!swallow) server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
  const marc = await context.newPage();
  await marc.goto('/');
  await marc.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await marc.getByLabel('Your name').fill('Tunnel Tom');
  await marc.getByRole('button', { name: 'Come in' }).click();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await talk(marc);
  const sam = await comeIn(browser, 'Tunnel Watcher');

  swallow = true;
  const said = ['tunnel one', 'tunnel two', 'tunnel three'];
  for (const line of said) {
    await marc.getByLabel('Say something').fill(line);
    await marc.getByRole('button', { name: 'Send' }).click();
    await expect(marc.getByLabel('Say something')).toHaveValue('');
  }
  await expect(sam.getByTestId('line').filter({ hasText: 'tunnel' })).toHaveCount(0);

  swallow = false;
  const heard = sam.getByTestId('line').filter({ hasText: 'tunnel ' });
  await expect(heard).toHaveCount(3, { timeout: 45_000 });
  // In the order he typed them, and nothing doubled once the dust settles.
  await expect(heard.nth(0)).toContainText('tunnel one');
  await expect(heard.nth(1)).toContainText('tunnel two');
  await expect(heard.nth(2)).toContainText('tunnel three');
  await expect(marc.getByText(/waiting for a signal/)).toHaveCount(0);
  await expect(heard).toHaveCount(3);

  await context.close();
  await sam.context().close();
});

test('a dad says it instead of typing it', async ({ browser }) => {
  const marc = await comeIn(browser, 'Hal');
  const sam = await comeIn(browser, 'Ike');

  // The room already holds whatever the earlier tests said; count what is ADDED.
  const before = await marc.getByTestId('voice-note').count();

  // With nothing typed, the composer offers the microphone rather than a send
  // button that would do nothing.
  await marc.getByTestId('record').click();
  await expect(marc.getByTestId('recording')).toBeVisible();

  // Long enough not to be a thumb brushing the button.
  await expect(marc.getByTestId('recording')).toContainText('0:01', { timeout: 5_000 });
  await marc.getByRole('button', { name: 'Send' }).click();

  // It lands as something playable, for him and for the room — no caption, no
  // confirmation step.
  await expect(marc.getByTestId('voice-note')).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(sam.getByTestId('voice-note')).toHaveCount(before + 1, { timeout: 15_000 });

  // And it says how long it is before anybody presses Play. Chrome's own
  // recording carries no length in its header — the browser reports it as
  // endless until it has played once — so the note had no length, a bar
  // that never filled, and a tap on it that went nowhere.
  await expect(sam.getByTestId('voice-clock').last()).toHaveText(/^0:0[1-9]$/, {
    timeout: 10_000,
  });

  // And the composer is back to normal.
  await expect(marc.getByTestId('recording')).toHaveCount(0);
  await expect(marc.getByTestId('record')).toBeVisible();

  await marc.context().close();
  await sam.context().close();
});

test('a recording thrown away is not sent', async ({ browser }) => {
  const marc = await comeIn(browser, 'Jos');

  // The room already holds whatever the earlier tests said; what matters is
  // that nothing is ADDED to it.
  const before = await marc.getByTestId('voice-note').count();

  await marc.getByTestId('record').click();
  await expect(marc.getByTestId('recording')).toBeVisible();
  await expect(marc.getByTestId('recording')).toContainText('0:01', { timeout: 5_000 });
  await marc.getByRole('button', { name: 'Throw it away' }).click();

  await expect(marc.getByTestId('recording')).toHaveCount(0);
  await marc.waitForTimeout(1500);
  await expect(marc.getByTestId('voice-note')).toHaveCount(before);

  await marc.context().close();
});

/** A dad on an iPhone, in the room, and a way to touch his screen for real:
 * Playwright's mouse is a mouse, and holding the microphone is a finger. */
async function phoneDad(browser: Browser, name: string) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  const mic = async () => {
    const box = (await page.getByTestId('record').boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  return { page, touch, mic };
}

test('on a phone, holding the microphone talks and lifting sends it', async ({ browser }) => {
  // Marc, 2026-11-02: the convention every phone chat has.
  const { page, touch, mic } = await phoneDad(browser, 'Hold Hank');
  const sam = await comeIn(browser, 'Hold Sam');
  const before = await sam.getByTestId('voice-note').count();

  const at = await mic();
  await touch('touchStart', at.x, at.y);
  // Held, the row says how to change his mind, and the finger is still down.
  await expect(page.getByTestId('recording')).toContainText('Slide left to throw it away');
  await expect(page.getByTestId('record')).toHaveAttribute('data-held', 'held');
  await expect(page.getByTestId('recording')).toContainText('0:01', { timeout: 5_000 });
  await touch('touchEnd');

  // Lifting sent it, with nothing more to press.
  await expect(page.getByTestId('recording')).toHaveCount(0);
  await expect(page.getByTestId('voice-note')).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(sam.getByTestId('voice-note')).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(page.getByTestId('record')).not.toHaveAttribute('data-held');

  await sam.context().close();
  await page.context().close();
});

test('on a phone, sliding left off the microphone throws the note away', async ({ browser }) => {
  const { page, touch, mic } = await phoneDad(browser, 'Slide Sid');
  const before = await page.getByTestId('voice-note').count();

  const at = await mic();
  await touch('touchStart', at.x, at.y);
  await expect(page.getByTestId('recording')).toContainText('0:01', { timeout: 5_000 });
  for (let step = 1; step <= 6; step++) await touch('touchMove', at.x - step * 20, at.y);
  // Past the line: letting go now is the cancel, and the row says so.
  await expect(page.getByTestId('recording')).toContainText('Let go to throw it away');
  await expect(page.getByTestId('record')).toHaveAttribute('data-held', 'armed');
  await touch('touchEnd');
  await expect(page.getByTestId('recording')).toHaveCount(0);

  // The sentinel: a line sent after it arrives, and no note came before it.
  await page.getByLabel('Say something').fill('slid it away 01');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('line').filter({ hasText: 'slid it away 01' })).toBeVisible();
  await expect(page.getByTestId('voice-note')).toHaveCount(before);

  await page.context().close();
});

test('on a phone, a tap on the microphone records hands-free', async ({ browser }) => {
  // One hand on a child: a tap starts it, and the row has its own two buttons.
  const { page } = await phoneDad(browser, 'Tap Tom');
  const before = await page.getByTestId('voice-note').count();

  await page.getByTestId('record').tap();
  await expect(page.getByTestId('recording')).toContainText('listening');
  await expect(page.getByRole('button', { name: 'Throw it away' })).toBeVisible();
  await expect(page.getByTestId('recording')).toContainText('0:01', { timeout: 5_000 });
  // Lifting the finger from the tap did not send it: it is still going.
  await expect(page.getByTestId('voice-note')).toHaveCount(before);
  await page.getByRole('button', { name: 'Send', exact: true }).tap();

  await expect(page.getByTestId('voice-note')).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(page.getByTestId('recording')).toHaveCount(0);

  await page.context().close();
});

test('a voice note plays faster, and the phone remembers how fast', async ({ browser }) => {
  const marc = await comeIn(browser, 'Speedy Ned');
  await marc.setInputFiles('#attach', {
    name: 'note.webm',
    mimeType: 'audio/webm',
    buffer: Buffer.alloc(2048),
  });
  await marc.getByLabel('Say something').fill('play this one faster');
  await marc.getByRole('button', { name: 'Send' }).click();
  const note = () =>
    marc.getByTestId('line').filter({ hasText: 'play this one faster' }).getByTestId('voice-note');
  await expect(note()).toBeVisible();

  const speed = () => note().getByTestId('voice-speed');
  const rate = () =>
    note()
      .locator('audio')
      .evaluate((el) => (el as HTMLAudioElement).playbackRate);
  await expect(speed()).toHaveAccessibleName('Speed 1×');
  await speed().click();
  await expect(speed()).toHaveAccessibleName('Speed 1.5×');
  await expect.poll(rate).toBe(1.5);

  // Every note on this phone, after a reload too.
  await marc.reload();
  await talk(marc);
  await expect(speed()).toHaveAccessibleName('Speed 1.5×');
  await expect.poll(rate).toBe(1.5);
  await speed().click();
  await expect(speed()).toHaveAccessibleName('Speed 2×');
  await speed().click();
  await expect(speed()).toHaveAccessibleName('Speed 1×');
  await expect.poll(rate).toBe(1);

  await marc.context().close();
});

test('a dad who was away lands on what he missed', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Back');
  const sam = await comeIn(browser, 'Sam Back');

  await sam.getByLabel('Say something').fill('seen this one');
  await sam.getByRole('button', { name: 'Send' }).click();
  await expect(marc.getByTestId('line').filter({ hasText: 'seen this one' })).toBeVisible();
  // A first sitting has nothing to divide.
  await expect(marc.getByTestId('since')).toHaveCount(0);

  await marc.goto('about:blank');
  for (const text of ['missed this', 'and this']) {
    await sam.getByLabel('Say something').fill(text);
    await sam.getByRole('button', { name: 'Send' }).click();
    await expect(sam.getByTestId('line').filter({ hasText: text })).toBeVisible();
  }

  await marc.goto('/');
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  await talk(marc);
  const since = marc.getByTestId('since');
  await expect(since).toHaveCount(1);
  await expect(since).toBeVisible();
  // Before the first line he missed, and nowhere else.
  await expect(since.locator('xpath=following-sibling::li[1]')).toContainText('missed this');

  await marc.context().close();
  await sam.context().close();
});

test('a dad takes a line back, and it goes for everyone', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Back2');
  const sam = await comeIn(browser, 'Sam Back2');

  await marc.getByLabel('Say something').fill('wrong room, sorry');
  await marc.getByRole('button', { name: 'Send' }).click();
  const his = sam.getByTestId('line').filter({ hasText: 'wrong room, sorry' });
  await expect(his).toBeVisible();

  // Right-click on a laptop, a long press on a phone: the same menu.
  await marc
    .getByTestId('line')
    .filter({ hasText: 'wrong room, sorry' })
    .click({ button: 'right' });
  await expect(marc.getByTestId('line-menu')).toBeVisible();

  // It arms before it fires, because this is irreversible.
  await marc.getByTestId('line-retract').click();
  await expect(marc.getByTestId('line-retract')).toContainText('Yes, take it back');
  await marc.getByTestId('line-retract').click();

  await expect(his).toHaveCount(0);
  await expect(marc.getByTestId('line').filter({ hasText: 'wrong room, sorry' })).toHaveCount(0);

  // And it is not handed to the next dad through the door.
  const dave = await comeIn(browser, 'Dave Back2');
  await expect(dave.getByTestId('line').filter({ hasText: 'wrong room, sorry' })).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
  await dave.context().close();
});

test('a dad answers a line, and the quote rides above his', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Reply');
  const sam = await comeIn(browser, 'Sam Reply');

  await marc.getByLabel('Say something').fill('who has the cards this week');
  await marc.getByRole('button', { name: 'Send' }).click();
  const asked = sam.getByTestId('line').filter({ hasText: 'who has the cards this week' });
  await expect(asked).toBeVisible();

  await asked.click({ button: 'right' });
  await sam.getByTestId('line-reply').click();
  // The composer says whom he is answering, and the field has the caret.
  await expect(sam.getByTestId('replying')).toContainText('Replying to Marc Reply');
  await expect(sam.getByLabel('Say something')).toBeFocused();
  await sam.getByLabel('Say something').fill('I do, still in the car');
  await sam.getByRole('button', { name: 'Send' }).click();

  // On both screens: the quote, then his words.
  for (const page of [sam, marc]) {
    const answer = page.getByTestId('line').filter({ hasText: 'I do, still in the car' });
    await expect(answer).toBeVisible();
    await expect(answer.getByTestId('quote')).toContainText('who has the cards this week');
    await expect(answer.getByTestId('quote')).toContainText('Marc Reply');
  }
  // And the strip is gone once it went.
  await expect(sam.getByTestId('replying')).toHaveCount(0);

  // Taking the original back takes the quote of it off the answer, on both
  // screens and without a reload: a quote is a copy of his words, and "then
  // it is gone" has to mean gone. The answer itself stays — they are Sam's
  // words and nobody else's to take.
  // Two rows hold those words now — his own line and the quote above Sam's
  // answer — so the original is the one with no quote on it.
  await marc
    .getByTestId('line')
    .filter({ hasText: 'who has the cards this week' })
    .filter({ hasNot: marc.getByTestId('quote') })
    .click({ button: 'right' });
  await marc.getByTestId('line-retract').click();
  await marc.getByTestId('line-retract').click();
  for (const page of [sam, marc]) {
    const answer = page.getByTestId('line').filter({ hasText: 'I do, still in the car' });
    await expect(answer).toBeVisible();
    await expect(answer.getByTestId('quote')).toHaveCount(0);
  }

  await marc.context().close();
  await sam.context().close();
});

test('a dad changes his own line, and the others read the new words', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Edit');
  const sam = await comeIn(browser, 'Sam Edit');

  await marc.getByLabel('Say something').fill('see you at nien');
  await marc.getByRole('button', { name: 'Send' }).click();
  const his = marc.getByTestId('line').filter({ hasText: 'see you at nien' });
  await expect(sam.getByTestId('line').filter({ hasText: 'see you at nien' })).toBeVisible();

  // His own line offers Edit; the field takes his words.
  await his.click({ button: 'right' });
  await marc.getByTestId('line-edit').click();
  await expect(marc.getByTestId('editing')).toBeVisible();
  await expect(marc.getByLabel('Say something')).toHaveValue('see you at nien');
  await marc.getByLabel('Say something').fill('see you at nine');
  await marc.getByRole('button', { name: 'Send' }).click();

  const fixed = sam.getByTestId('line').filter({ hasText: 'see you at nine' });
  await expect(fixed).toBeVisible();
  await expect(fixed.getByTestId('edited')).toBeVisible();
  await expect(sam.getByTestId('line').filter({ hasText: 'see you at nien' })).toHaveCount(0);
  await expect(marc.getByTestId('editing')).toHaveCount(0);

  // Somebody else's line offers no Edit.
  await fixed.click({ button: 'right' });
  await expect(sam.getByTestId('line-menu')).toBeVisible();
  await expect(sam.getByTestId('line-edit')).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('a phone that drops out and comes back sees what happened to the lines it holds', async ({
  browser,
}) => {
  // Sam's socket goes, the way a tunnel takes it, and while he is gone Marc
  // changes a line Sam already has and marks it. Neither moves the line's
  // seq, so a backfill by seq would never mention them: the resume carries
  // them (`?rev=`), and Sam's screen shows both without a reload.
  const marc = await comeIn(browser, 'Marc Tunnel');

  const context = await browser.newContext();
  let down = false;
  const live: WebSocketRoute[] = [];
  await context.routeWebSocket('**/ws*', (ws) => {
    if (down) {
      void ws.close();
      return;
    }
    const server = ws.connectToServer();
    live.push(ws);
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
  });
  const sam = await context.newPage();
  await sam.goto('/');
  await sam.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await sam.getByLabel('Your name').fill('Sam Tunnel');
  await sam.getByRole('button', { name: 'Come in' }).click();
  await expect(sam.getByTestId('connection')).toHaveText(/here$/);
  await talk(sam);

  await marc.getByLabel('Say something').fill('into the tunnel at eight');
  await marc.getByRole('button', { name: 'Send' }).click();
  const his = marc.getByTestId('line').filter({ hasText: 'into the tunnel at eight' });
  await expect(his).toBeVisible();
  await expect(
    sam.getByTestId('line').filter({ hasText: 'into the tunnel at eight' }),
  ).toBeVisible();

  // Into the tunnel.
  down = true;
  for (const ws of live.splice(0)) await ws.close();

  await his.click({ button: 'right' });
  await marc.getByTestId('line-edit').click();
  await marc.getByLabel('Say something').fill('out of the tunnel at nine');
  await marc.getByRole('button', { name: 'Send' }).click();
  const changed = marc.getByTestId('line').filter({ hasText: 'out of the tunnel at nine' });
  await expect(changed).toBeVisible();
  await changed.click({ button: 'right' });
  await marc.getByTestId('line-menu').getByTestId('react-🙏').click();
  await expect(changed.getByTestId('mark').filter({ hasText: '🙏' })).toContainText('1');

  // Out of it. His socket comes back on its own, and resumes.
  down = false;
  const samLine = sam.getByTestId('line').filter({ hasText: 'out of the tunnel at nine' });
  await expect(samLine).toBeVisible({ timeout: 20_000 });
  await expect(samLine.getByTestId('mark').filter({ hasText: '🙏' })).toContainText('1');
  await expect(sam.getByTestId('line').filter({ hasText: 'into the tunnel at eight' })).toHaveCount(
    0,
  );

  await marc.context().close();
  await context.close();
});

test('an edit the room took, whose answer was lost, is not reported as lost', async ({
  browser,
}) => {
  // The room changes the line and says so — and that answer dies with the
  // socket. The resume carries the new words, and the composer takes that as
  // the answer: it lets go of them rather than telling him, a few seconds
  // later, that they did not land and inviting him to send them twice.
  const context = await browser.newContext();
  let eatEdits = false;
  const live: WebSocketRoute[] = [];
  await context.routeWebSocket('**/ws*', (ws) => {
    const server = ws.connectToServer();
    live.push(ws);
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (eatEdits && typeof m === 'string' && m.includes('"t":"edited"')) {
        // The answer is lost, and the socket with it.
        eatEdits = false;
        void ws.close();
        return;
      }
      ws.send(m);
    });
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill('Marc Lostanswer');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);

  await page.getByLabel('Say something').fill('lost answer at seven');
  await page.getByRole('button', { name: 'Send' }).click();
  const his = page.getByTestId('line').filter({ hasText: 'lost answer at seven' });
  await expect(his).toBeVisible();

  await his.click({ button: 'right' });
  await page.getByTestId('line-edit').click();
  await page.getByLabel('Say something').fill('lost answer at eight');
  eatEdits = true;
  await page.getByRole('button', { name: 'Send' }).click();

  // Back on a new socket, the line says what he changed it to, and the
  // composer has let go of the words.
  await expect(page.getByTestId('line').filter({ hasText: 'lost answer at eight' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('editing')).toHaveCount(0);
  await expect(page.getByLabel('Say something')).toHaveValue('');
  // Past the grace, still nothing saying it failed.
  await page.waitForTimeout(9_000);
  await expect(page.getByText(/didn’t reach the room/)).toHaveCount(0);

  await context.close();
});

test('a change that never reached the room leaves him holding his words', async ({ browser }) => {
  // The dead spot: the socket stays OPEN and swallows everything, which is
  // what a tunnel does and what going offline does not. A chat line survives
  // this because the outbox holds it until it comes back — and a change to a
  // line has to survive it the same way, because the alternative is the app
  // clearing a man's new words and leaving the old ones on the screen with
  // nothing anywhere saying why.
  const context = await browser.newContext();
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
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill('Marc Deadspot');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);

  await page.getByLabel('Say something').fill('bedtime at seven');
  await page.getByRole('button', { name: 'Send' }).click();
  const his = page.getByTestId('line').filter({ hasText: 'bedtime at seven' });
  await expect(his).toBeVisible();

  await his.click({ button: 'right' });
  await page.getByTestId('line-edit').click();
  await page.getByLabel('Say something').fill('bedtime at eight');

  swallow = true;
  await page.getByRole('button', { name: 'Send' }).click();

  // The room never answers, so after the grace he is told — and he still has
  // what he typed, and the line still says what it always said.
  await expect(page.getByText(/didn’t reach the room/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('editing')).toBeVisible();
  await expect(page.getByLabel('Say something')).toHaveValue('bedtime at eight');
  await expect(his).toBeVisible();

  // And pressing it again once the signal is back is all it takes.
  swallow = false;
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('line').filter({ hasText: 'bedtime at eight' })).toBeVisible();
  await expect(page.getByTestId('editing')).toHaveCount(0);

  await context.close();
});

test('the answer to an edit he walked away from does not touch the next one', async ({
  browser,
}) => {
  // An edit waits for its line to come back changed. Meanwhile he can press
  // Escape and pick Edit on another line — and when the first answer finally
  // arrived, it cleared the SECOND edit's words as if they had landed.
  const context = await browser.newContext();
  let hold = false;
  const held: (() => void)[] = [];
  await context.routeWebSocket('**/ws*', (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (hold && typeof m === 'string' && m.includes('"t":"edited"')) {
        held.push(() => ws.send(m));
        return;
      }
      ws.send(m);
    });
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill('Marc Twoedits');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);

  const field = page.getByLabel('Say something');
  for (const words of ['two edits first 01', 'two edits second 02']) {
    await field.fill(words);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('line').filter({ hasText: words })).toBeVisible();
  }
  const first = page.getByTestId('line').filter({ hasText: 'two edits first' });
  const second = page.getByTestId('line').filter({ hasText: 'two edits second' });

  await first.click({ button: 'right' });
  await page.getByTestId('line-edit').click();
  await field.fill('two edits first changed 03');
  hold = true;
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => held.length).toBe(1);

  // He walks away from it and starts on the other line.
  await field.press('Escape');
  await expect(page.getByTestId('editing')).toHaveCount(0);
  await second.click({ button: 'right' });
  await page.getByTestId('line-edit').click();
  await field.fill('two edits second, half typed');

  // The first answer lands now. It is about a line he is no longer editing.
  hold = false;
  held.shift()!();
  await expect(page.getByTestId('line').filter({ hasText: 'first changed 03' })).toBeVisible();
  await expect(page.getByTestId('editing')).toBeVisible();
  await expect(field).toHaveValue('two edits second, half typed');
  await expect(page.getByText(/didn’t reach the room/)).toHaveCount(0);

  await context.close();
});

test('a line that is not yours offers no way to take it back', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Back3');
  const sam = await comeIn(browser, 'Sam Back3');

  await marc.getByLabel('Say something').fill('this one stays');
  await marc.getByRole('button', { name: 'Send' }).click();
  const his = sam.getByTestId('line').filter({ hasText: 'this one stays' });
  await expect(his).toBeVisible();

  await his.click({ button: 'right' });
  await expect(sam.getByTestId('line-menu')).toBeVisible();
  // Copy, and nothing else: what a man said is his.
  await expect(sam.getByTestId('line-menu')).toContainText('Copy');
  await expect(sam.getByTestId('line-retract')).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('a mark says you read it without spending a line', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Mark');
  const sam = await comeIn(browser, 'Sam Mark');

  await marc.getByLabel('Say something').fill('long night, both of them up');
  await marc.getByRole('button', { name: 'Send' }).click();
  const line = sam.getByTestId('line').filter({ hasText: 'long night, both of them up' });
  await expect(line).toBeVisible();

  // A line nobody has marked carries no control at all — that is what keeps
  // this out of the conversation.
  await expect(line.getByTestId('mark')).toHaveCount(0);

  await line.click({ button: 'right' });
  await sam.getByTestId('react-👍').click();

  // On his screen and on the other dad's, with the count of men rather than
  // a list of names.
  await expect(line.getByTestId('mark')).toContainText('1');
  const his = marc.getByTestId('line').filter({ hasText: 'long night, both of them up' });
  await expect(his.getByTestId('mark')).toContainText('1');

  // Marc adds his to the same mark by tapping it, without opening anything.
  await his.getByTestId('mark').click();
  await expect(his.getByTestId('mark')).toContainText('2');
  await expect(line.getByTestId('mark')).toContainText('2');

  // And pressing his own again takes it off.
  await his.getByTestId('mark').click();
  await expect(his.getByTestId('mark')).toContainText('1');

  // Holding a mark says who put it there (Marc, 2026-11-01), without putting
  // his own on it and without opening the line's menu under it.
  const mark = his.getByTestId('mark');
  await mark.hover();
  await marc.mouse.down();
  // `HOLD_MS` in Marks.tsx is 500; held well past it.
  await marc.waitForTimeout(800);
  await marc.mouse.up();
  const who = marc.getByTestId('mark-who');
  await expect(who).toBeVisible();
  await expect(who).toContainText('Sam Mark');
  await expect(who).not.toContainText('Marc Mark');
  await expect(mark).toContainText('1');
  await expect(marc.getByRole('menu')).toHaveCount(0);
  await marc.keyboard.press('Escape');
  await expect(who).toHaveCount(0);

  // A right-click is the same question on a laptop.
  await mark.click({ button: 'right' });
  await expect(who).toBeVisible();
  await expect(marc.getByRole('menu')).toHaveCount(0);
  await marc.keyboard.press('Escape');
  await expect(who).toHaveCount(0);

  // A short tap is still a mark of his own.
  await mark.click();
  await expect(mark).toContainText('2');

  await marc.context().close();
  await sam.context().close();
});

test('a mouse gets a button for a mark, and a double tap is a thumb', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Quick');
  const sam = await comeIn(browser, 'Sam Quick');

  await marc.getByLabel('Say something').fill('anyone else up at five');
  await marc.getByRole('button', { name: 'Send' }).click();
  const line = sam.getByTestId('line').filter({ hasText: 'anyone else up at five' });
  await expect(line).toBeVisible();

  // The button is there for the pointer and shows itself under it.
  await line.hover();
  await line.getByTestId('quick-mark').click();
  await sam.getByTestId('quick-marks').getByTestId('react-❤️').click();
  await expect(line.getByTestId('mark')).toContainText('1');

  // A double tap on the words is a thumb, and another takes it off.
  const his = marc.getByTestId('line').filter({ hasText: 'anyone else up at five' });
  await his.locator('.body').dblclick();
  await expect(his.getByTestId('mark').filter({ hasText: '👍' })).toContainText('1');
  await his.locator('.body').dblclick();
  await expect(his.getByTestId('mark').filter({ hasText: '👍' })).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('on a phone, a long press on any line is the menu and a tap is its one thing', async ({
  browser,
}) => {
  // A real touch screen, pressed with real touch events: a long press is a
  // finger held down, a tap is a finger that lifts at once. On every kind of
  // line the long press must open the menu and NOTHING else — no text
  // selected under it, no photo opened under it, no link followed — and the
  // tap must do the one thing that kind of line does.
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill('Pat Press');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);

  const field = page.getByLabel('Say something');
  const send = async (
    caption: string,
    file?: { name: string; mimeType: string; buffer: Buffer },
  ) => {
    if (file) await page.setInputFiles('#attach', file);
    await field.fill(caption);
    await page.getByRole('button', { name: 'Send' }).click();
    // A link shows shortened, so the line is found by the words before it.
    const words = caption.split(' http')[0]!;
    await expect(page.getByTestId('line').filter({ hasText: words })).toBeVisible();
  };
  await send('press words only');
  await send('press a link https://example.com/far');
  await send('press a photo', {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: readFileSync('public/icon-192.png'),
  });
  await send('press a clip', {
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(2048),
  });
  await send('press a voice note', {
    name: 'note.webm',
    mimeType: 'audio/webm',
    buffer: Buffer.alloc(2048),
  });

  const cdp = await context.newCDPSession(page);
  const press = async (target: Locator, holdMs: number) => {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 20) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(holdMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const longPress = (target: Locator) => press(target, 900);
  const menuShows = async () => {
    await expect(page.getByTestId('line-menu')).toBeVisible();
    // No words half-selected under the menu, no loupe, no handles.
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  };
  const closeMenu = async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('line-menu')).toHaveCount(0);
  };
  const line = (text: string) => page.getByTestId('line').filter({ hasText: text });

  // The words: the menu, and not the marks the lift would otherwise open.
  await longPress(line('press words only').locator('.body'));
  await menuShows();
  await page.waitForTimeout(200);
  // Copying is in the menu, since the phone no longer selects.
  await page.getByTestId('line-copy').tap();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('press words only');
  await expect(page.getByTestId('line-menu')).toHaveCount(0);
  // And a tap on the words is nothing at all (the row of marks it used to
  // open went on 2026-11-01): no menu, no marks.
  await line('press words only').locator('.body').tap();
  await page.waitForTimeout(200);
  await expect(page.getByTestId('line-menu')).toHaveCount(0);
  await expect(line('press words only').getByTestId('mark')).toHaveCount(0);

  // A link: the menu, and nowhere else.
  const pages = context.pages().length;
  await longPress(line('press a link').locator('a'));
  await menuShows();
  await page.waitForTimeout(300);
  expect(context.pages().length).toBe(pages);
  await closeMenu();

  // A photograph: the menu, and not the viewer under it. A tap is the viewer.
  const photo = line('press a photo').getByTestId('photo');
  await longPress(photo);
  await menuShows();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('viewer')).toHaveCount(0);
  await closeMenu();
  await photo.tap();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('viewer')).toHaveCount(0);

  // A clip and a voice note: the menu, from the player itself.
  await longPress(line('press a clip').locator('video'));
  await menuShows();
  await closeMenu();
  await longPress(line('press a voice note').getByTestId('voice-note'));
  await menuShows();
  await closeMenu();
  // And a tap on its play button plays it — it opens neither the menu nor
  // the marks. (The app's own player: the browser's kept every touch to
  // itself, so a long press on a voice note never reached the line.)
  await line('press a voice note').getByRole('button', { name: 'Play the voice note' }).tap();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('line-menu')).toHaveCount(0);

  await context.close();
});

test('a line taken back from under an open menu does not eat the next tap', async ({ browser }) => {
  // Sam holds a finger on Marc's line and the menu is up. Marc, on his own
  // phone, takes the line back — and the menu goes with it, unmounted while
  // open, which is a close Radix never reports. The flag that said "a menu is
  // open" stayed up for good, and from then on every tap on every line was
  // swallowed as the lift at the end of a long press: no marks, no photo, no
  // link, a play button that did nothing.
  const marc = await comeIn(browser, 'Marc Withdraws');
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const sam = await context.newPage();
  await sam.goto('/');
  await sam.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await sam.getByLabel('Your name').fill('Sam Pressing');
  await sam.getByRole('button', { name: 'Come in' }).click();
  await expect(sam.getByTestId('connection')).toHaveText(/here$/);
  await talk(sam);

  for (const words of ['flag line one', 'flag line two']) {
    await marc.getByLabel('Say something').fill(words);
    await marc.getByLabel('Say something').press('Enter');
    await expect(sam.getByTestId('line').filter({ hasText: words })).toBeVisible();
  }

  const cdp = await context.newCDPSession(sam);
  const first = sam.getByTestId('line').filter({ hasText: 'flag line one' });
  await first.scrollIntoViewIfNeeded();
  const box = (await first.locator('.body').boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 20) };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await sam.waitForTimeout(900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(sam.getByTestId('line-menu')).toBeVisible();

  const marcs = marc.getByTestId('line').filter({ hasText: 'flag line one' });
  await marcs.click({ button: 'right' });
  await marc.getByTestId('line-retract').click();
  await marc.getByTestId('line-retract').click();
  await expect(first).toHaveCount(0);
  await expect(sam.getByTestId('line-menu')).toHaveCount(0);

  // A plain tap on the line still there is not eaten: Marc's thumb on it
  // takes Sam's tap, and the count moves.
  const second = sam.getByTestId('line').filter({ hasText: 'flag line two' });
  await marc.getByTestId('line').filter({ hasText: 'flag line two' }).click({ button: 'right' });
  await marc.getByTestId('react-👍').click();
  await expect(second.getByTestId('mark')).toContainText('1');
  await second.getByTestId('mark').tap();
  await expect(second.getByTestId('mark')).toContainText('2');

  await context.close();
  await marc.context().close();
});

test('a laptop gets an emoji button, and it lands where the caret is', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc Emoji');

  const field = marc.getByLabel('Say something');
  await field.fill('made it through the week');
  // The caret after "made it": the emoji goes there, not at the end.
  await field.evaluate((el: HTMLInputElement) => el.setSelectionRange(7, 7));
  await marc.getByTestId('emoji').click();
  await marc.getByTestId('emoji-picker').getByRole('button', { name: '🍺' }).click();
  await expect(field).toHaveValue('made it🍺 through the week');
  // And the field kept focus, so he just keeps typing.
  await expect(field).toBeFocused();

  await marc.getByRole('button', { name: 'Send' }).click();
  await expect(marc.getByTestId('line').filter({ hasText: 'made it🍺 through' })).toBeVisible();

  await marc.context().close();
});

test('every mark is reachable wherever on the line he presses', async ({ browser }) => {
  // The menu is anchored at the point he pressed, so pressing near the right
  // edge of a phone leaves it about two hundred pixels — and a fixed width
  // put the fifth mark off the screen where nobody could reach it. It is
  // capped by Radix's own available-width now, and wraps rather than clips.
  // The row is six and a "+" since marks learned, and those two are the END
  // of it — the ones an edge would push off first.
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill('Otto Edge');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);

  await page.getByLabel('Say something').fill('pressed at the edge');
  await page.getByRole('button', { name: 'Send' }).click();
  const line = page.getByTestId('line').filter({ hasText: 'pressed at the edge' });
  await expect(line).toBeVisible();

  // Pressed relative to the line, so Playwright waits for it to hold still:
  // a long list is still settling at the bottom when the line first shows.
  const box = (await line.boundingBox())!;
  await line.click({ button: 'right', position: { x: box.width - 6, y: 10 } });
  await expect(page.getByTestId('line-menu')).toBeVisible();

  for (const id of ['👍', '❤️', '😂', '💪', '🙏', '😎', 'more']) {
    const mark = await page.getByTestId(`react-${id}`).boundingBox();
    expect(mark, `${id} is not on the screen at all`).not.toBeNull();
    expect(mark!.x, `${id} is off the left`).toBeGreaterThanOrEqual(0);
    expect(mark!.x + mark!.width, `${id} is off the right`).toBeLessThanOrEqual(430);
  }

  await context.close();
});

test('a face sits beside a run, once, and the words below it line up', async ({ browser }) => {
  // Both widths: wide is four columns and a phone is two rows, and the face
  // gutter has to behave in each. The alignment matters because every line is
  // its OWN grid — nothing lines up across rows unless the tracks are fixed,
  // and auto-placement slid a continued line into the name column when there
  // was no face in the gutter to hold its place.
  for (const width of [1200, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
    await page.getByLabel('Your name').fill(`Pat ${width}`);
    await page.getByRole('button', { name: 'Come in' }).click();
    await expect(page.getByTestId('connection')).toHaveText(/here$/);
    await talk(page);

    const first = `first of a run at ${width}`;
    const second = `and its continuation at ${width}`;
    for (const text of [first, second]) {
      await page.getByLabel('Say something').fill(text);
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByTestId('line').filter({ hasText: text })).toBeVisible();
    }

    const top = page.getByTestId('line').filter({ hasText: first });
    const next = page.getByTestId('line').filter({ hasText: second });

    // His name and his face, once, at the top of the run.
    await expect(top.locator('.face')).toHaveCount(1);
    await expect(next.locator('.face')).toHaveCount(0);

    const a = (await top.locator('.body').boundingBox())!;
    const b = (await next.locator('.body').boundingBox())!;
    expect(Math.abs(a.x - b.x), `bodies must align at ${width}`).toBeLessThan(2);
    // And the words start after the gutter, not inside it.
    expect(a.x).toBeGreaterThan(32);

    await context.close();
  }
});

test('a photo opens in the app, moves between them, and can be kept', async ({ browser }) => {
  const marc = await comeIn(browser, 'Quentin Shots');

  // Two, so the viewer has something to move between.
  const pngs = [
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ];
  for (const [i, data] of pngs.entries()) {
    await marc.setInputFiles('#attach', {
      name: `shot-${i}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    });
    await marc.getByLabel('Say something').fill(`shot ${i}`);
    await marc.getByRole('button', { name: 'Send' }).click();
    await expect(marc.getByTestId('line').filter({ hasText: `shot ${i}` })).toBeVisible();
  }

  // Tapping one opens it HERE, rather than throwing him into a browser tab
  // with no way back but the app switcher. Scoped to his own line: the viewer
  // holds every photo in the conversation, and earlier tests in this file
  // share the room.
  await marc.getByTestId('line').filter({ hasText: 'shot 0' }).getByTestId('photo').click();
  await expect(marc.getByTestId('viewer')).toBeVisible();
  // Told apart by what they are, not by name: the alt says who sent it, and
  // both are his.
  const src = (words: string) =>
    marc.getByTestId('line').filter({ hasText: words }).locator('img').getAttribute('src');
  const [first, second] = [await src('shot 0'), await src('shot 1')];
  await expect(marc.getByTestId('viewer-shot')).toHaveAttribute('src', first!);
  await expect(marc.getByTestId('viewer')).toContainText(/\d+ of \d+/);

  // The others in the conversation are an arrow away, by button and by key.
  await marc.getByTestId('viewer-next').click();
  await expect(marc.getByTestId('viewer-shot')).toHaveAttribute('src', second!);
  await marc.keyboard.press('ArrowLeft');
  await expect(marc.getByTestId('viewer-shot')).toHaveAttribute('src', first!);

  // And there is a way to keep it.
  await expect(marc.getByTestId('viewer-save')).toBeVisible();

  // The phone's back button closes the picture, not the app.
  await marc.goBack();
  await expect(marc.getByTestId('viewer')).toHaveCount(0);
  await expect(marc.getByLabel('Say something')).toBeVisible();
  await marc.getByTestId('line').filter({ hasText: 'shot 0' }).getByTestId('photo').click();
  await expect(marc.getByTestId('viewer')).toBeVisible();

  // Escape closes it, and the conversation is still where he left it.
  await marc.keyboard.press('Escape');
  await expect(marc.getByTestId('viewer')).toHaveCount(0);
  await expect(marc.getByLabel('Say something')).toBeVisible();

  await marc.context().close();
});

test('a photo can be made to stay, and the other dad sees that it has', async ({ browser }) => {
  const marc = await comeIn(browser, 'Wendell Stays');
  const sam = await comeIn(browser, 'Yusuf Stays');

  await marc.setInputFiles('#attach', {
    name: 'stays.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await marc.getByLabel('Say something').fill('the one that stays');
  await marc.getByRole('button', { name: 'Send' }).click();

  const his = marc.getByTestId('line').filter({ hasText: 'the one that stays' });
  const hers = sam.getByTestId('line').filter({ hasText: 'the one that stays' });
  await expect(hers).toBeVisible();
  // Nothing at rest: a room where every photograph carried a badge saying it
  // was ordinary would be a room with a badge on every photograph.
  await expect(his.getByTestId('kept')).toHaveCount(0);

  // The long press, which on a laptop is the right-click the same primitive
  // gives us.
  await his.click({ button: 'right' });
  await marc.getByTestId('line-keep').click();

  // Not optimistic: the mark appears because the ROOM said so, which is why
  // the other dad's screen gets it too without a reload.
  await expect(his.getByTestId('kept')).toBeVisible();
  await expect(hers.getByTestId('kept')).toBeVisible();

  // And any dad may let it go again — it is the room's picture, not his.
  await hers.click({ button: 'right' });
  await sam.getByTestId('line-keep').click();
  await expect(his.getByTestId('kept')).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('a dad at the bottom stays at the bottom when the last line grows', async ({ browser }) => {
  // Reactions and photographs make a line taller AFTER it arrived. He used to
  // be left a few lines short, the newest line's reactions off the screen.
  const page = await comeIn(browser, 'Bottom');
  for (let i = 0; i < 25; i++) {
    await page.getByLabel('Say something').fill(`grow ${String(i).padStart(2, '0')}`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
  }
  await expect(page.getByTestId('line').filter({ hasText: 'grow 24' })).toBeVisible();

  const gap = () =>
    page.evaluate(() => {
      const list = document.querySelector('ol.lines')!;
      return Math.round(list.scrollHeight - list.scrollTop - list.clientHeight);
    });
  await expect.poll(gap).toBeLessThan(4);

  // The newest line gets taller, the way a row of reactions makes it.
  await page.evaluate(() => {
    const rows = document.querySelectorAll('ol.lines > li');
    const last = [...rows].reverse().find((r) => (r as HTMLElement).offsetHeight > 0)!;
    (last as HTMLElement).style.paddingBottom = '90px';
  });
  await expect.poll(gap).toBeLessThan(4);

  // But a dad who has scrolled up is left where he is.
  await page.evaluate(() => {
    document.querySelector('ol.lines')!.scrollTop = 0;
  });
  await expect.poll(gap).toBeGreaterThan(200);
  await page.evaluate(() => {
    const rows = document.querySelectorAll('ol.lines > li');
    const last = [...rows].reverse().find((r) => (r as HTMLElement).offsetHeight > 0)!;
    (last as HTMLElement).style.paddingBottom = '180px';
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelector('ol.lines')!.scrollTop)).toBeLessThan(5);

  // Unless he sends something: his own line is what he wants to see next
  // (Marc, 2026-11-01), so sending takes him to the bottom from wherever he
  // was reading, and the line that comes back lands where he can see it.
  await page.getByLabel('Say something').fill('sent from the top');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('line').filter({ hasText: 'sent from the top' })).toBeVisible();
  await expect.poll(gap).toBeLessThan(4);

  await page.context().close();
});

test('a way back down from far up', async ({ browser }) => {
  // Marc asked (2026-11-02): far up the week with nothing new, he had to
  // thumb all the way back. One button, two looks: the count when something
  // new is below, a bare arrow named "Newest" when nothing is. On a 390px
  // phone, so it is checked against the composer where it matters.
  const far = await comeInOnAPhone(browser, 'Far Up');
  const near = await comeIn(browser, 'Near Down');
  const gap = () =>
    far.evaluate(() => {
      const list = document.querySelector('ol.lines')!;
      return Math.round(list.scrollHeight - list.scrollTop - list.clientHeight);
    });
  // "Far up" is more than a screen above the bottom, so the list has to be
  // well over two screens tall. Said here, by this test, rather than left to
  // what the tests before it put in the shared room: run on its own it had
  // 25 lines and 763px of list on a 488px screen, and no arrow to find.
  const tall = () =>
    far.evaluate(() => {
      const list = document.querySelector('ol.lines')!;
      return list.scrollHeight > 2.5 * list.clientHeight;
    });
  for (let i = 0; i < 80 && !(await tall()); i++) {
    const words = `far ${String(i).padStart(2, '0')}`;
    await far.getByLabel('Say something').fill(words);
    await far.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(far.getByTestId('line').filter({ hasText: words })).toBeVisible();
  }
  expect(await tall()).toBe(true);
  const scrollTo = (where: 'top' | 'near') =>
    far.evaluate((where) => {
      const list = document.querySelector('ol.lines')!;
      list.scrollTop = where === 'top' ? 0 : list.scrollHeight - list.clientHeight - 100;
    }, where);
  const down = far.getByTestId('to-bottom');

  // At the bottom there is nowhere to go.
  await expect.poll(gap).toBeLessThan(4);
  await expect(down).toHaveCount(0);

  // From the top, the arrow, named for where it goes, above the composer.
  await scrollTo('top');
  await expect(down).toBeVisible();
  await expect(down).toHaveAccessibleName(/^Newest$/);
  const button = (await down.boundingBox())!;
  const composer = (await far.locator('form.composer').boundingBox())!;
  expect(button.y + button.height).toBeLessThanOrEqual(composer.y);
  expect(button.width).toBeGreaterThanOrEqual(44);

  // Within a screen of the bottom it goes: a flick does that job.
  await scrollTo('near');
  await expect(down).toHaveCount(0);

  // Pressed from the top, it takes him all the way down and goes.
  await scrollTo('top');
  await down.click();
  await expect.poll(gap).toBeLessThan(4);
  await expect(down).toHaveCount(0);

  // Far up again, and the other dad says something: the same button counts it.
  await scrollTo('top');
  await expect(down).toHaveAccessibleName(/^Newest$/);
  await near.getByLabel('Say something').fill('while you were up there');
  await near.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(down).toHaveText(/^1 new/);
  await down.click();
  await expect.poll(gap).toBeLessThan(4);
  await expect(down).toHaveCount(0);
  await expect(
    far.getByTestId('line').filter({ hasText: 'while you were up there' }),
  ).toBeVisible();

  await far.context().close();
  await near.context().close();
});

test('the album shows what the shelf holds, and a tap opens the viewer on it', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'Alma Album');
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await marc.setInputFiles('#attach', {
    name: 'album-one.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await marc.getByLabel('Say something').fill('for the album');
  await marc.getByRole('button', { name: 'Send' }).click();
  await expect(marc.getByTestId('line').filter({ hasText: 'for the album' })).toBeVisible();

  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('menu-album').click();
  const album = marc.getByTestId('album');
  await expect(album).toBeVisible();
  // His picture is on the shelf, under his name.
  await expect(
    album.getByRole('button', { name: /A photo from Alma Album/ }).first(),
  ).toBeVisible();

  await album.getByTestId('album-shot').first().click();
  await expect(marc.getByTestId('viewer')).toBeVisible();
  // Named for who sent it, as on the line (2026-11-01), never the file name.
  await expect(marc.getByTestId('viewer-shot')).toHaveAttribute('alt', /^A photo from /);

  // The phone's back button closes the picture, not the app (Marc, Android,
  // 2026-11-01): the viewer goes and the album is still under it; once more
  // and the album goes, the conversation still where he left it.
  await marc.goBack();
  await expect(marc.getByTestId('viewer')).toHaveCount(0);
  await expect(album).toBeVisible();
  await marc.goBack();
  await expect(album).toHaveCount(0);
  await expect(marc.getByLabel('Say something')).toBeVisible();

  // Closing with the X tidies its entry away, so the history is back on the
  // conversation's own entry (the first layer over home).
  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('menu-album').click();
  await expect(album).toBeVisible();
  await expect.poll(() => marc.evaluate(() => history.state)).toEqual({ dadsLayers: 2 });
  await marc.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(album).toHaveCount(0);
  await expect.poll(() => marc.evaluate(() => history.state)).toEqual({ dadsLayers: 1 });
});

test('a sheet opened the instant another closed stays open, and back still closes it', async ({
  browser,
}) => {
  // Closing a sheet travels back over its history entry, and a traversal is
  // asynchronous. Opening the next sheet in the same breath used to push its
  // entry on top of that back, and the back then landed on the base and
  // popped the new sheet shut — which is how the a11y suite found it.
  const marc = await comeIn(browser, 'Quick Sheets');
  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('menu-album').click();
  await expect(marc.getByTestId('album')).toBeVisible();
  await marc.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('menu-album').click();
  await expect(marc.getByTestId('album')).toBeVisible();
  // Still open once the history has settled on its entry.
  await expect.poll(() => marc.evaluate(() => history.state)).toEqual({ dadsLayers: 2 });
  await expect(marc.getByTestId('album')).toBeVisible();
  await marc.goBack();
  await expect(marc.getByTestId('album')).toHaveCount(0);
  await expect(marc.getByLabel('Say something')).toBeVisible();
});

test('back from the conversation is home, and back from a sheet is the conversation', async ({
  browser,
}) => {
  // The conversation is the first layer over home (Marc, 2026-11-01: it
  // was so on an iPhone, and on Android back left the app). Home is the
  // base: back from there leaves, and nothing here can test leaving.
  const marc = await comeIn(browser, 'Back Home');
  const room = marc.locator('main.room');
  await expect(room).toHaveAttribute('data-view', 'talk');
  await expect.poll(() => marc.evaluate(() => history.state)).toEqual({ dadsLayers: 1 });

  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('menu-album').click();
  await expect(marc.getByTestId('album')).toBeVisible();
  await expect.poll(() => marc.evaluate(() => history.state)).toEqual({ dadsLayers: 2 });
  await marc.goBack();
  await expect(marc.getByTestId('album')).toHaveCount(0);
  await expect(room).toHaveAttribute('data-view', 'talk');
  await marc.goBack();
  await expect(room).toHaveAttribute('data-view', 'home');
  await expect.poll(() => marc.evaluate(() => history.state)).toBeNull();

  // Going in again is a new entry; the way-back control tidies it away.
  await talk(marc);
  await expect.poll(() => marc.evaluate(() => history.state)).toEqual({ dadsLayers: 1 });
  await marc.getByTestId('go-home').click();
  await expect(room).toHaveAttribute('data-view', 'home');
  await expect.poll(() => marc.evaluate(() => history.state)).toBeNull();
});

test('an @ tags a dad by his name, and the line shows him in his colour', async ({ browser }) => {
  const marc = await comeIn(browser, 'Tag Marc');
  const sam = await comeIn(browser, 'Tag Sam');
  const field = marc.getByLabel('Say something');
  const picks = marc.getByTestId('tag-picks');

  // Typing "@" and the start of a name offers the dads it could be — not
  // himself. The room has had many dads by now; a two-word start keeps it
  // to the one.
  await field.fill('hey @tag s');
  await expect(picks).toBeVisible();
  await expect(picks.getByRole('option')).toHaveCount(1);
  await picks.getByRole('option', { name: /Tag Sam/ }).click();
  await expect(field).toHaveValue('hey @Tag Sam ');
  await expect(picks).toHaveCount(0);
  await field.pressSequentially('you up?');
  await marc.getByRole('button', { name: 'Send', exact: true }).click();

  // On the other dad's screen the name is a name, and the words are the
  // words typed.
  const line = sam.getByTestId('line').filter({ hasText: 'you up?' });
  await expect(line).toBeVisible();
  await expect(line.getByTestId('mention')).toHaveText('@Tag Sam');
  await expect(line).toContainText('hey @Tag Sam you up?');

  // Enter takes the first offered; Escape puts the list away for that "@".
  await field.fill('@tag s');
  await expect(picks).toBeVisible();
  await field.press('Enter');
  await expect(field).toHaveValue('@Tag Sam ');
  await field.fill('@tag s');
  await expect(picks).toBeVisible();
  // The field says which row the keys are on, by id, and never that it is
  // "expanded": a textarea is a textbox, not a combobox.
  const on = await picks.getByRole('option', { selected: true }).getAttribute('id');
  await expect(field).toHaveAttribute('aria-activedescendant', on!);
  await expect(field).not.toHaveAttribute('aria-expanded', /.*/);
  await field.press('Escape');
  await expect(picks).toHaveCount(0);

  await marc.context().close();
  await sam.context().close();
});

test('a line can be more than one line', async ({ browser }) => {
  // Marc chose it, 2026-11-01: the field grows, Shift+Enter is a new line,
  // Enter still sends.
  const marc = await comeIn(browser, 'Lines Marc');
  const sam = await comeIn(browser, 'Lines Sam');
  const field = marc.getByLabel('Say something');
  const height = async () => (await field.boundingBox())!.height;
  const one = await height();

  await field.click();
  await field.pressSequentially('multi first line');
  await field.press('Shift+Enter');
  await field.pressSequentially('multi second line');
  await expect(field).toHaveValue('multi first line\nmulti second line');
  expect(await height()).toBeGreaterThan(one);
  await field.press('Enter');

  // The break he typed is the break both of them read.
  for (const page of [marc, sam]) {
    const body = page.getByTestId('line').filter({ hasText: 'multi second line' }).locator('.body');
    await expect(body).toBeVisible();
    expect(await body.evaluate((el) => (el as HTMLElement).innerText)).toContain(
      'multi first line\nmulti second line',
    );
  }
  await expect(field).toHaveValue('');
  await expect.poll(height).toBe(one);
  await expect(field).toBeFocused();

  // Five lines and no more: past that the field scrolls rather than taking
  // the conversation's screen.
  await field.fill('one\ntwo\nthree\nfour\nfive');
  const five = await height();
  expect(five).toBeGreaterThan(one * 2);
  await field.fill('one\ntwo\nthree\nfour\nfive\nsix\nseven\neight');
  await expect.poll(height).toBe(five);
  await field.fill('');
  await expect.poll(height).toBe(one);

  await marc.context().close();
  await sam.context().close();
});

test('a keyboard can see the composer', async ({ browser }) => {
  const marc = await comeIn(browser, 'Ring Marc');
  const field = marc.getByLabel('Say something');
  const ring = () =>
    marc.locator('form.composer').evaluate((el) => getComputedStyle(el).outlineStyle);

  await field.blur();
  await expect.poll(ring).toBe('none');
  // From the attach control, one Tab: the way a keyboard arrives.
  await marc.locator('#attach').focus();
  await marc.keyboard.press('Tab');
  await expect(field).toBeFocused();
  await expect.poll(ring).toBe('solid');
  await marc.context().close();

  // A thumb tapping into the field on a phone gets no ring.
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await context.newPage();
  await phone.goto('/');
  await phone.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await phone.getByLabel('Your name').fill('Ring Sam');
  await phone.getByRole('button', { name: 'Come in' }).click();
  await expect(phone.getByTestId('connection')).toHaveText(/here$/);
  await talk(phone);
  await phone.getByLabel('Say something').tap();
  await expect(phone.getByLabel('Say something')).toBeFocused();
  expect(
    await phone.locator('form.composer').evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe('none');
  await context.close();
});

test('a kept draft that starts with a name opens no names, and Enter sends it', async ({
  browser,
}) => {
  // 2026-11-02: the caret started at 0 under a restored draft, so "@Sam ..."
  // opened the names on load and Enter put a name in at the start.
  const sam = await comeIn(browser, 'Sam Drafted');
  const dora = await comeIn(browser, 'Dora Drafts');
  const field = dora.getByLabel('Say something');
  await field.fill('@Sam Drafted are you in?');
  await expect
    .poll(() =>
      dora.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith('dads.draft.'))
          .map((k) => localStorage.getItem(k)),
      ),
    )
    .toEqual(['@Sam Drafted are you in?']);
  await sam.getByLabel('Say something').fill('sam drafted is here');
  await sam.getByLabel('Say something').press('Enter');
  await dora.reload();
  await talk(dora);
  await expect(field).toHaveValue('@Sam Drafted are you in?');
  // The room's hello has come (it brings the members with the lines), so
  // the names would be showing by now if they were going to.
  await expect(dora.getByTestId('line').filter({ hasText: 'sam drafted is here' })).toBeVisible();
  await expect(dora.getByTestId('tag-picks')).toHaveCount(0);
  await field.focus();
  await expect(dora.getByTestId('tag-picks')).toHaveCount(0);
  await field.press('Enter');
  await expect(
    sam.getByTestId('line').filter({ hasText: '@Sam Drafted are you in?' }),
  ).toBeVisible();
  await expect(field).toHaveValue('');

  await sam.context().close();
  await dora.context().close();
});

test('a half-typed line is still there after a reload', async ({ browser }) => {
  // Marc chose it, 2026-11-01: the draft is his, per room, on this phone.
  const marc = await comeIn(browser, 'Draft Marc');
  const field = marc.getByLabel('Say something');
  const kept = () =>
    marc.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('dads.draft.'))
        .map((k) => localStorage.getItem(k)),
    );

  await field.fill('half a line');
  await expect.poll(kept).toEqual(['half a line']);
  await marc.reload();
  await talk(marc);
  await expect(field).toHaveValue('half a line');

  // Changing a line borrows the field and gives the draft back after.
  await field.fill('draft line to change');
  await field.press('Enter');
  const his = marc.getByTestId('line').filter({ hasText: 'draft line to change' });
  await expect(his).toBeVisible();
  await expect.poll(kept).toEqual([]);
  await field.fill('kept under the edit');
  await expect.poll(kept).toEqual(['kept under the edit']);
  await his.click({ button: 'right' });
  await marc.getByTestId('line-edit').click();
  await expect(field).toHaveValue('draft line to change');
  await field.fill('draft line to change, changed');
  await marc.getByTestId('context-clear').click();
  await expect(field).toHaveValue('kept under the edit');
  expect(await kept()).toEqual(['kept under the edit']);

  // Sent, it is gone, reload or no reload.
  await field.press('Enter');
  await expect(marc.getByTestId('line').filter({ hasText: 'kept under the edit' })).toBeVisible();
  await expect(field).toHaveValue('');
  await marc.reload();
  await talk(marc);
  await expect(marc.getByTestId('line').filter({ hasText: 'kept under the edit' })).toBeVisible();
  await expect(field).toHaveValue('');

  await marc.context().close();
});

test('on a phone, a swipe to the right on a line is a reply', async ({ browser }) => {
  // Marc, 2026-11-01: "WhatsApp has a swipe right on a message to reply,
  // with a small vibration". Real touches, through the devtools protocol:
  // Playwright's mouse is a mouse, and a mouse drag on a line is a man
  // selecting words.
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill('Swipe Sam');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
  const marc = await comeIn(browser, 'Swipe Marc');
  await marc.getByLabel('Say something').fill('swipe on this one');
  await marc.getByRole('button', { name: 'Send' }).click();
  const line = page.getByTestId('line').filter({ hasText: 'swipe on this one' });
  await expect(line).toBeVisible();

  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  const box = (await line.boundingBox())!;
  const x = box.x + 40;
  const y = box.y + box.height / 2;

  // Across and past the arming point: the composer answers him.
  await touch('touchStart', x, y);
  for (let step = 1; step <= 8; step++) await touch('touchMove', x + step * 10, y + 1);
  await touch('touchEnd', 0, 0);
  await expect(page.getByTestId('replying')).toContainText('Replying to Swipe Marc');
  await expect(page.getByLabel('Say something')).toBeFocused();
  await page.getByTestId('context-clear').click();
  await expect(page.getByTestId('replying')).toHaveCount(0);

  // A short nudge is nothing, and so is a drag that starts downwards: that
  // one is the browser's scroll.
  await touch('touchStart', x, y);
  await touch('touchMove', x + 25, y);
  await touch('touchEnd', 0, 0);
  await touch('touchStart', x, y);
  await touch('touchMove', x + 2, y + 30);
  await touch('touchMove', x + 80, y + 60);
  await touch('touchEnd', 0, 0);
  await expect(page.getByTestId('replying')).toHaveCount(0);
  // And the line is back where it was.
  await expect.poll(() => line.evaluate((el) => (el as HTMLElement).style.translate)).toBe('');

  await marc.context().close();
  await context.close();
});

test('a reload with a sheet open lands on the base, in the same page', async ({ browser }) => {
  // A home-screen app woken on a new build reloads where it was. The page
  // then sits on the sheet's entry with no sheet, so one back would do
  // nothing and the second would leave. It goes back to the base itself —
  // and that travel must be within the page, not a second load.
  const marc = await comeIn(browser, 'Reload Sheets');
  await marc.getByRole('button', { name: 'Menu' }).click();
  await marc.getByTestId('menu-album').click();
  await expect.poll(() => marc.evaluate(() => history.state)).toEqual({ dadsLayers: 2 });
  await marc.reload();
  await expect(marc.getByTestId('connection')).toHaveText(/here$/);
  // It reopens in the conversation (closed there a moment ago), which is
  // the one layer over home again; the sheet's entry is gone.
  await expect(marc.locator('main.room')).toHaveAttribute('data-view', 'talk');
  await expect.poll(() => marc.evaluate(() => history.state)).toEqual({ dadsLayers: 1 });
  const loads = await marc.evaluate(() =>
    performance.getEntriesByType('navigation').map((e) => (e as PerformanceNavigationTiming).type),
  );
  expect(loads).toEqual(['reload']);
});

test('a dad can download what he has written, and only his own profile offers it', async ({
  browser,
}) => {
  const marc = await comeIn(browser, 'Export Marc');
  const sam = await comeIn(browser, 'Export Sam');
  await marc.getByLabel('Say something').fill('for the file, from Marc');
  await marc.getByRole('button', { name: 'Send' }).click();
  await sam.getByLabel('Say something').fill('not for Marc’s file');
  await sam.getByRole('button', { name: 'Send' }).click();
  await expect(marc.getByTestId('line').filter({ hasText: 'not for Marc’s file' })).toBeVisible();

  await marc.getByTestId('connection').click();
  // Sam's profile has no download; his own does.
  await marc.getByTestId('roster-profile').filter({ hasText: 'Export Sam' }).click();
  await expect(marc.getByTestId('profile-name')).toContainText('Export Sam');
  await expect(marc.getByTestId('profile-export')).toHaveCount(0);
  await marc.getByRole('button', { name: 'Everyone', exact: true }).click();
  await marc.getByTestId('roster-profile').filter({ hasText: 'Export Marc' }).click();

  const [download] = await Promise.all([
    marc.waitForEvent('download'),
    marc.getByTestId('profile-export').getByRole('link').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^dads-.*-export-marc\.json$/);
  const file = readFileSync((await download.path())!, 'utf8');
  expect(file).toContain('for the file, from Marc');
  expect(file).not.toContain('not for Marc’s file');

  await marc.context().close();
  await sam.context().close();
});

/** A dad on a phone: the iPhone context, in through the door like anybody. */
async function comeInOnAPhone(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
  return page;
}

test('a keyboard reaches a line, and its menu', async ({ browser }) => {
  // 2026-11-01: the list is one Tab stop, the arrows move between the lines,
  // and Enter on one opens the menu the right click and the long press open.
  const kim = await comeIn(browser, 'Kim Keys');
  for (const words of ['keys line 01', 'keys line 02']) {
    await kim.getByLabel('Say something').fill(words);
    await kim.getByLabel('Say something').press('Enter');
    await expect(kim.getByTestId('line').filter({ hasText: words })).toBeVisible();
  }
  const line = (words: string) => kim.getByTestId('line').filter({ hasText: words });
  const menu = kim.getByTestId('line-menu');

  await kim.locator('ol.lines').focus();
  await expect(line('keys line 02')).toBeFocused();
  await kim.keyboard.press('ArrowUp');
  await expect(line('keys line 01')).toBeFocused();
  await kim.keyboard.press('End');
  await expect(line('keys line 02')).toBeFocused();
  await kim.keyboard.press('ArrowUp');

  // Enter is the menu; Escape puts it away and the line has the focus back.
  await kim.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await kim.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(line('keys line 01')).toBeFocused();

  // Shift+F10, the other key every desktop opens a context menu with.
  await kim.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await kim.getByTestId('line-reply').focus();
  await kim.keyboard.press('Enter');
  await expect(kim.getByTestId('replying')).toContainText('Replying to Kim Keys');
  await expect(kim.getByLabel('Say something')).toBeFocused();
  await kim.getByTestId('context-clear').click();

  // Tab from a line leaves the list rather than walking every mark in it.
  await kim.locator('ol.lines').focus();
  await expect(line('keys line 02')).toBeFocused();
  await kim.keyboard.press('Tab');
  expect(
    await kim.evaluate(
      () => document.activeElement !== null && document.activeElement.closest('ol') === null,
    ),
  ).toBe(true);

  await kim.context().close();
});

test('Shift+Tab from the composer comes up onto the newest line', async ({ browser }) => {
  // 2026-11-02: going back up from the field, the browser walked into the
  // list from its end — the newest line's last link or mark — and not onto
  // a line. The attach button sits between the field and the list and keeps
  // its place in the order.
  const kim = await comeIn(browser, 'Kim Back');
  for (const words of ['back tab line 01', 'back tab line 02 https://example.com']) {
    await kim.getByLabel('Say something').fill(words);
    await kim.getByLabel('Say something').press('Enter');
    await expect(kim.getByTestId('line').filter({ hasText: words.slice(0, 16) })).toBeVisible();
  }
  const newest = kim.getByTestId('line').filter({ hasText: 'back tab line 02' });
  await expect(newest.getByRole('link')).toBeVisible();
  const field = kim.getByLabel('Say something');
  const attach = kim.locator('#attach');

  await field.focus();
  await kim.keyboard.press('Shift+Tab');
  await expect(attach).toBeFocused();
  await kim.keyboard.press('Shift+Tab');
  await expect(newest).toBeFocused();
  // The arrows work from there, as from a Tab from above.
  await kim.keyboard.press('ArrowUp');
  await expect(kim.getByTestId('line').filter({ hasText: 'back tab line 01' })).toBeFocused();
  await kim.keyboard.press('End');
  await expect(newest).toBeFocused();

  // And Tab from the line goes back down the same way.
  await kim.keyboard.press('Tab');
  await expect(attach).toBeFocused();
  await kim.keyboard.press('Tab');
  await expect(field).toBeFocused();

  // Focus put on the link inside the line any other way stays on the link.
  await field.focus();
  await newest.getByRole('link').focus();
  await expect(newest.getByRole('link')).toBeFocused();

  await kim.context().close();
});

test('a screen reader hears a line arrive', async ({ browser }) => {
  const lena = await comeIn(browser, 'Lena Listens');
  const sam = await comeIn(browser, 'Sam Speaks');

  // His own line first: the sentinel for "his own is never read to him".
  await lena.getByLabel('Say something').fill('lena says hello');
  await lena.getByLabel('Say something').press('Enter');
  await expect(sam.getByTestId('line').filter({ hasText: 'lena says hello' })).toBeVisible();

  await sam.getByLabel('Say something').fill('heard you loud and clear');
  await sam.getByLabel('Say something').press('Enter');
  const log = lena.getByTestId('log');
  await expect(log).toContainText('Sam Speaks: heard you loud and clear');
  // One child per arrival, and nothing from the backfill this shared room
  // already held when he came in.
  await expect(log.locator('p')).toHaveCount(1);
  await expect(log).not.toContainText('lena says hello');

  await lena.context().close();
  await sam.context().close();
});

test('a picture is named for the man who sent it', async ({ browser }) => {
  const lena = await comeIn(browser, 'Lena Looks');
  const sam = await comeIn(browser, 'Sam Snaps');
  await sam.setInputFiles('#attach', {
    name: 'IMG_0001.png',
    mimeType: 'image/png',
    buffer: readFileSync('public/icon-192.png'),
  });
  await sam.getByLabel('Say something').fill('named picture');
  await sam.getByRole('button', { name: 'Send' }).click();

  const line = lena.getByTestId('line').filter({ hasText: 'named picture' });
  await expect(line.getByTestId('photo').locator('img')).toHaveAttribute(
    'alt',
    'A photo from Sam Snaps',
  );
  await expect(lena.getByTestId('log')).toContainText('Sam Snaps: named picture, a photo');
  await line.getByTestId('photo').click();
  await expect(lena.getByTestId('viewer-shot')).toHaveAttribute('alt', 'A photo from Sam Snaps');

  await lena.context().close();
  await sam.context().close();
});

test('a name on a line opens his profile', async ({ browser }) => {
  const pia = await comeIn(browser, 'Pia Profile');
  const ned = await comeIn(browser, 'Ned Named');
  await ned.getByLabel('Say something').fill('ned has a line here');
  await ned.getByLabel('Say something').press('Enter');
  const line = pia.getByTestId('line').filter({ hasText: 'ned has a line here' });
  await expect(line).toBeVisible();

  // The name is a button saying whose profile it opens; the face says the same.
  await expect(line.getByTestId('line-who')).toHaveAccessibleName('Ned Named profile');
  await expect(line.getByTestId('line-face')).toHaveAccessibleName('Ned Named profile');
  await line.getByTestId('line-who').click();
  await expect(pia.getByTestId('profile-name')).toHaveText('Ned Named');
  await pia.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(pia.getByTestId('profile')).toHaveCount(0);
  await expect(pia.getByLabel('Say something')).toBeVisible();

  // His face is the same way in.
  await line.getByTestId('line-face').click();
  await expect(pia.getByTestId('profile-name')).toHaveText('Ned Named');
  await pia.getByRole('button', { name: 'Close', exact: true }).click();

  // And the header still opens on everybody, not on the last man looked at.
  await pia.getByTestId('connection').click();
  await expect(pia.getByTestId('here')).toBeVisible();
  await expect(pia.getByTestId('profile')).toHaveCount(0);
  await pia.getByRole('button', { name: 'Close', exact: true }).click();

  await pia.context().close();
  await ned.context().close();
});

test('on a phone, a name opens his profile and a tap on nothing puts the keyboard away', async ({
  browser,
}) => {
  const pat = await comeInOnAPhone(browser, 'Pat Thumb');
  const ned = await comeIn(browser, 'Ned Tapped');
  await ned.getByLabel('Say something').fill('tap near this line');
  await ned.getByLabel('Say something').press('Enter');
  const line = pat.getByTestId('line').filter({ hasText: 'tap near this line' });
  await expect(line).toBeVisible();

  // The keyboard up, then a tap on the words: it goes down so he can read.
  const field = pat.getByLabel('Say something');
  await field.tap();
  await expect(field).toBeFocused();
  await line.locator('.body').tap();
  await expect(field).not.toBeFocused();

  // Again with nothing focused: nothing at all, and no menu in the way of the
  // next tap — which is his name, and his profile.
  await line.locator('.body').tap();
  await line.getByTestId('line-who').tap();
  await expect(pat.getByTestId('profile-name')).toHaveText('Ned Tapped');
  await expect(pat.getByTestId('line-menu')).toHaveCount(0);

  await pat.context().close();
  await ned.context().close();
});

test('on a phone, a photo swipes to the next, zooms in two fingers, and swipes down to close', async ({
  browser,
}) => {
  // Marc, 2026-11-02: the gestures every phone's viewer has. Real touches,
  // through the devtools protocol: Playwright's mouse is a mouse, and the
  // viewer keeps a mouse to its buttons.
  const page = await comeInOnAPhone(browser, 'Vic Viewer');
  // Big enough to be worth zooming: a 1px picture has nowhere to pan to.
  const files = ['public/icon-512.png', 'public/icon-192.png'];
  for (const [i, path] of files.entries()) {
    await page.setInputFiles('#attach', {
      name: `vic-${i}.png`,
      mimeType: 'image/png',
      buffer: readFileSync(path),
    });
    await page.getByLabel('Say something').fill(`vic picture ${'ab'[i]}`);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(
      page.getByTestId('line').filter({ hasText: `vic picture ${'ab'[i]}` }),
    ).toBeVisible();
  }
  const src = (words: string) =>
    page.getByTestId('line').filter({ hasText: words }).locator('img').getAttribute('src');
  const [first, second] = [await src('vic picture a'), await src('vic picture b')];

  await page.getByTestId('line').filter({ hasText: 'vic picture a' }).getByTestId('photo').click();
  const viewer = page.getByTestId('viewer');
  const shot = viewer.getByTestId('viewer-shot');
  await expect(shot).toHaveAttribute('src', first!);

  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  /** One finger from (x, y), by (dx, dy), in eight steps. */
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await touch('touchStart', [[x, y]]);
    for (let step = 1; step <= 8; step++)
      await touch('touchMove', [[x + (dx * step) / 8, y + (dy * step) / 8]]);
    await touch('touchEnd', []);
  };
  const box = (await viewer.getByTestId('viewer-stage').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Left is the next one, right the one before.
  await drag(cx + 100, cy, -220, 4);
  await expect(shot).toHaveAttribute('src', second!);
  await drag(cx - 100, cy, 220, 4);
  await expect(shot).toHaveAttribute('src', first!);

  // A short, slow pull (well under a third of the width, and the finger
  // resting before it lifts, so no flick) springs back: the same picture, and
  // the track back at nought. The track having moved while the finger was on
  // is what makes "back at nought" mean something.
  const track = viewer.locator('.viewer-track');
  const across = () => track.evaluate((el) => (el as HTMLElement).style.translate);
  await touch('touchStart', [[cx + 40, cy]]);
  for (let step = 1; step <= 6; step++) await touch('touchMove', [[cx + 40 - step * 10, cy + 1]]);
  await expect.poll(across).toMatch(/^-\d/);
  // The finger rests: a flick is measured over the last moments before the
  // lift, and a finger that has stopped has no speed. Part of the gesture,
  // not a wait for the app.
  await page.waitForTimeout(150);
  await touch('touchEnd', []);
  await expect.poll(across).toBe('');
  await expect(shot).toHaveAttribute('src', first!);

  // Two fingers apart: it grows about them.
  await touch('touchStart', [
    [cx - 20, cy],
    [cx + 20, cy],
  ]);
  for (let step = 1; step <= 8; step++)
    await touch('touchMove', [
      [cx - 20 - step * 12, cy],
      [cx + 20 + step * 12, cy],
    ]);
  await touch('touchEnd', []);
  const scale = () => shot.evaluate((el) => Number((el as HTMLElement).style.scale || 1));
  await expect.poll(scale).toBeGreaterThan(1.5);

  // Zoomed in, a finger down the picture pans it and does not close it, and
  // the sideways part of it does not move on.
  await drag(cx, cy, -40, 160);
  await expect.poll(() => shot.evaluate((el) => (el as HTMLElement).style.translate)).not.toBe('');
  await expect(viewer).toBeVisible();
  await expect(shot).toHaveAttribute('src', first!);

  // A double tap is back to the whole picture, and another is in again.
  const tap = async () => {
    await touch('touchStart', [[cx, cy]]);
    await touch('touchEnd', []);
  };
  await tap();
  await tap();
  await expect.poll(scale).toBe(1);
  await tap();
  await tap();
  await expect.poll(scale).toBe(2.5);
  await tap();
  await tap();
  await expect.poll(scale).toBe(1);

  // At rest again, down closes it, onto the conversation as he left it.
  await drag(cx, cy, 0, 200);
  await expect(viewer).toHaveCount(0);
  await expect(page.getByLabel('Say something')).toBeVisible();
  await expect(page.locator('main.room')).toHaveAttribute('data-view', 'talk');

  await page.context().close();
});
