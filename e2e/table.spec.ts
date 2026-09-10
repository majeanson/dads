import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_TABLE_GROUP } from './global-setup';

// One group, one table.
test.describe.configure({ mode: 'serial' });

/**
 * A stand-in for jaffre, served from jaffre's own origin so the bridge's
 * origin check is exercised rather than bypassed.
 *
 * The real jaffre is deliberately not part of this suite: how the table plays
 * is jaffre's to test, and framing a live third-party site would make these
 * runs depend on the network. What dads owns is the link it builds and what it
 * does with what the table says.
 *
 * It speaks twice — once on load, once a second later — because the frame can
 * be ready before the room's socket is, and because two identical events
 * arriving is exactly the case the room has to collapse.
 */
const STUB_TABLE = `<!doctype html><meta charset="utf-8"><h1>stub table</h1>
<script>
  const say = () => parent.postMessage({ v: 1, t: 'game-started' }, '*');
  say();
  setTimeout(say, 1000);
</script>`;

/** A table that loads and then says nothing at all. */
const MUTE_TABLE = '<!doctype html><meta charset="utf-8"><h1>a table that says nothing</h1>';

/**
 * Everything that is not the conversation lives behind the one Menu button.
 *
 * Scoped to the menu because Playwright matches accessible names by substring,
 * and one curated prompt ends "...with no phone in the room?". Anchored regex
 * rather than an exact name: an item with something waiting is called
 * "Board — something waiting", which is exactly what a screen reader should
 * hear, and the label is the prefix.
 */
async function open(page: Page, name: 'Prompts' | 'Board' | 'Open the table' | 'Dad night') {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
}

async function comeIn(browser: Browser, name: string, body = STUB_TABLE): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://jaffre.marcportal.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body }),
  );
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_TABLE_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  return page;
}

test('the group gets its own table, addressed to the dad by name', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');

  // The table is not there until it is asked for, at any width: an evening
  // starts as a conversation.
  await expect(marc.getByTestId('table').locator('iframe')).toBeHidden();

  await open(marc, 'Open the table');
  const frame = marc.getByTestId('table').locator('iframe');
  await expect(frame).toBeVisible();

  const src = await frame.getAttribute('src');
  expect(src).toContain('#room/e2e-table');
  expect(src).toContain('name=Marc');
  expect(src).toContain('from=dads');

  // And a way out to its own tab, which must not carry his name with it.
  const out = marc.getByRole('link', { name: /own tab/ });
  await expect(out).toHaveAttribute('href', /from=dads/);
  await expect(out).not.toHaveAttribute('href', /name=/);

  // Wide, the conversation is still there beside it.
  await expect(marc.getByLabel('Say something')).toBeVisible();

  await marc.context().close();
});

test('what the table says reaches the room, once', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // The frame is mounted from the start whether or not it is on screen — that
  // is what keeps a game alive across a closed table — so both browsers relay
  // the same event without either of them opening anything.
  const line = sam.getByTestId('line').filter({ hasText: 'A game started at the table' });
  await expect(line).toHaveCount(1);
  await expect(
    marc.getByTestId('line').filter({ hasText: 'A game started at the table' }),
  ).toHaveCount(1);

  await marc.context().close();
  await sam.context().close();
});

test('on a phone the table takes the room’s place, and gives it back', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 400, height: 780 } });
  const page = await context.newPage();
  await page.route('https://jaffre.marcportal.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: STUB_TABLE }),
  );
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_TABLE_GROUP.code);
  await page.getByLabel('Your name').fill('Phone');
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);

  // No room for both, so the room is what you see and the table is offered.
  await expect(page.getByLabel('Say something')).toBeVisible();
  await expect(page.getByTestId('table').locator('iframe')).toBeHidden();

  await open(page, 'Open the table');
  await expect(page.getByTestId('table').locator('iframe')).toBeVisible();
  await expect(page.getByLabel('Say something')).toBeHidden();

  // And the table hands the room back from its own head, without a trip
  // through the menu.
  await page.getByTestId('table').getByRole('button', { name: 'Close the table' }).click();
  await expect(page.getByLabel('Say something')).toBeVisible();
  await expect(page.getByTestId('table').locator('iframe')).toBeHidden();

  await context.close();
});

test('a table that never speaks offers a way out', async ({ browser }) => {
  // What a browser that refuses a third-party frame its storage looks like
  // from out here. Nothing about it is detectable across origins, so the only
  // honest signal is silence.
  const page = await comeIn(browser, 'Quiet', MUTE_TABLE);
  await open(page, 'Open the table');

  // Nothing is claimed early: the frame may simply be slow.
  await expect(page.getByTestId('table-silent')).toHaveCount(0);

  // The notice sits ABOVE the frame rather than replacing it — the table may
  // be perfectly usable and just mute.
  await expect(page.getByTestId('table-silent')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table').locator('iframe')).toBeVisible();
  await expect(
    page.getByTestId('table-silent').getByRole('link', { name: /own tab/ }),
  ).toBeVisible();

  await page.context().close();
});
