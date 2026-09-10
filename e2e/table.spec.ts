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

function view(page: Page, name: 'Room' | 'Table' | 'Prompts' | 'Board') {
  return page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name, exact: true });
}

async function comeIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://jaffre.marcportal.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: STUB_TABLE }),
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

  await view(marc, 'Table').click();
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
