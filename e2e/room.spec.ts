import { expect, test, type Browser, type Page } from '@playwright/test';
import { talk } from './talk';
import { E2E_ROOM_GROUP } from './global-setup';

// One room, one roster: these tests would see each other's dads if they ran
// at the same time.
test.describe.configure({ mode: 'serial' });

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_ROOM_GROUP.code);
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
  await marc.getByLabel('Code').fill(E2E_ROOM_GROUP.code);
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

test('a dad says it instead of typing it', async ({ browser }) => {
  const marc = await comeIn(browser, 'Hal');
  const sam = await comeIn(browser, 'Ike');

  // With nothing typed, the composer offers the microphone rather than a send
  // button that would do nothing.
  await marc.getByTestId('record').click();
  await expect(marc.getByTestId('recording')).toBeVisible();

  // Long enough not to be a thumb brushing the button.
  await expect(marc.getByTestId('recording')).toContainText('0:01', { timeout: 5_000 });
  await marc.getByRole('button', { name: 'Send' }).click();

  // It lands as something playable, for him and for the room — no caption, no
  // confirmation step.
  await expect(marc.getByTestId('voice-note')).toHaveCount(1, { timeout: 15_000 });
  await expect(sam.getByTestId('voice-note')).toHaveCount(1, { timeout: 15_000 });

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
  await expect(sam.getByTestId('mark')).toHaveCount(0);

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
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_ROOM_GROUP.code);
  await page.getByLabel('Your name').fill('Otto Edge');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);

  await page.getByLabel('Say something').fill('pressed at the edge');
  await page.getByRole('button', { name: 'Send' }).click();
  const line = page.getByTestId('line').filter({ hasText: 'pressed at the edge' });
  await expect(line).toBeVisible();

  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + box.width - 6, box.y + 10, { button: 'right' });
  await expect(page.getByTestId('line-menu')).toBeVisible();

  for (const emoji of ['👍', '❤️', '😂', '💪', '🙏']) {
    const mark = await page.getByTestId(`react-${emoji}`).boundingBox();
    expect(mark, `${emoji} is not on the screen at all`).not.toBeNull();
    expect(mark!.x, `${emoji} is off the left`).toBeGreaterThanOrEqual(0);
    expect(mark!.x + mark!.width, `${emoji} is off the right`).toBeLessThanOrEqual(430);
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
    await page.getByLabel('Code').fill(E2E_ROOM_GROUP.code);
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
  await expect(marc.getByTestId('viewer-shot')).toHaveAttribute('alt', 'shot-0.png');
  await expect(marc.getByTestId('viewer')).toContainText(/\d+ of \d+/);

  // The others in the conversation are an arrow away, by button and by key.
  await marc.getByTestId('viewer-next').click();
  await expect(marc.getByTestId('viewer-shot')).toHaveAttribute('alt', 'shot-1.png');
  await marc.keyboard.press('ArrowLeft');
  await expect(marc.getByTestId('viewer-shot')).toHaveAttribute('alt', 'shot-0.png');

  // And there is a way to keep it.
  await expect(marc.getByTestId('viewer-save')).toBeVisible();

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
