import { expect, test, type Browser, type Page } from '@playwright/test';
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
  await expect(marc.getByTestId('line-retract')).toContainText('sure?');
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
