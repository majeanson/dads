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

function action(page: Page, name: 'Prompts' | 'Board' | 'Table' | 'Back to the room') {
  return page
    .getByRole('toolbar', { name: 'Room actions' })
    .getByRole('button', { name, exact: true });
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

  // At this width the table sits beside the room already — there is nothing
  // to open, and the toggle is not offered.
  await expect(action(marc, 'Table')).toBeHidden();
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

  await marc.context().close();
});

test('what the table says reaches the room, once', async ({ browser }) => {
  const marc = await comeIn(browser, 'Marc');
  const sam = await comeIn(browser, 'Sam');

  // Both dads have the table open — the frame is mounted from the start — so
  // both browsers relay the same event.
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

  await action(page, 'Table').click();
  await expect(page.getByTestId('table').locator('iframe')).toBeVisible();
  await expect(page.getByLabel('Say something')).toBeHidden();

  await action(page, 'Back to the room').click();
  await expect(page.getByLabel('Say something')).toBeVisible();
  await expect(page.getByTestId('table').locator('iframe')).toBeHidden();

  await context.close();
});

test('a table that never speaks offers a way out', async ({ browser }) => {
  // What a browser that refuses a third-party frame its storage looks like
  // from out here. Nothing about it is detectable across origins, so the only
  // honest signal is silence.
  const page = await comeIn(browser, 'Quiet', MUTE_TABLE);

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
