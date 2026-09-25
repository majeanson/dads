import {
  devices,
  expect,
  test,
  type Locator,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import { talk } from './talk';
import { E2E_SAFARI_GROUP } from './global-setup';

/*
 * The dads on iPhones, in Safari's engine.
 *
 * Everything else runs in Chromium, and an iPhone is not Chromium: the
 * splash's SVG mask, touch and pointer events, the visual viewport, image
 * decoding for a face and focus handling all differ, and until this file the
 * only check was a man with a phone. This runs in the `webkit-iphone` project
 * only (playwright.config.ts) and covers what a dad does with his thumb —
 * behaviour, not pixels, like every other spec.
 *
 * What it cannot prove is iOS itself: the loupe, the callout, the keyboard
 * and the native long-press recognizer are the operating system's, and
 * WebKit on a desktop has none of them. The long press here is the pointer
 * events Radix listens for, which is the app's half of that gesture.
 */
test.describe.configure({ mode: 'serial' });

async function comeIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_SAFARI_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
}

async function say(page: Page, words: string): Promise<Locator> {
  await page.getByLabel('Say something').fill(words);
  await page.getByRole('button', { name: 'Send' }).click();
  const line = page.getByTestId('line').filter({ hasText: words });
  await expect(line).toBeVisible();
  return line;
}

/** A thumb held down, as the pointer events Radix's long press listens for. */
async function longPress(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 20);
  await target.evaluate(
    (el, at) => {
      const init = {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: at.x,
        clientY: at.y,
      };
      el.dispatchEvent(new PointerEvent('pointerdown', init));
    },
    { x, y },
  );
  await target.page().waitForTimeout(900);
  await target.evaluate((el) =>
    el.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
      }),
    ),
  );
}

test('the door, home, and the way in through the glasses', async ({ page }) => {
  await comeIn(page, 'Ada Safari');
  const room = page.locator('main.room');
  await expect(room).toHaveAttribute('data-view', 'home');
  // The way in plays the splash through the right lens — a masked SVG driven
  // frame by frame, which is exactly what Safari paints its own way.
  await page.getByTestId('home-go').tap();
  await expect(room).toHaveAttribute('data-view', 'talk');
  await expect(page.getByLabel('Say something')).toBeVisible();
});

test('home fits the phone without scrolling', async ({ page }) => {
  await comeIn(page, 'Bo Safari');
  const home = page.locator('.home');
  await expect(home).toBeVisible();
  const { scroll, client } = await home.evaluate((el) => ({
    scroll: el.scrollHeight,
    client: el.clientHeight,
  }));
  expect(scroll).toBeLessThanOrEqual(client + 1);
});

test('a line goes out and the field keeps the keyboard', async ({ page }) => {
  await comeIn(page, 'Cy Safari');
  await talk(page);
  await say(page, 'safari line 01');
  await expect(page.getByLabel('Say something')).toBeFocused();
});

test('a tap on a line is the marks, and a mark lands', async ({ page }) => {
  await comeIn(page, 'Di Safari');
  await talk(page);
  const line = await say(page, 'safari line 02 to mark');
  await line.locator('.body').tap();
  const row = line.getByTestId('tap-marks');
  await expect(row).toBeVisible();
  await row.getByTestId('react-💪').tap();
  await expect(row).toHaveCount(0);
  await expect(line.getByTestId('mark').filter({ hasText: '💪' })).toContainText('1');
});

test('a long press is the menu, and Reply hands the composer the caret', async ({ page }) => {
  await comeIn(page, 'Ed Safari');
  await talk(page);
  const line = await say(page, 'safari line 03 to answer');
  await page.getByLabel('Say something').blur();

  await longPress(line.locator('.body'));
  await expect(page.getByTestId('line-menu')).toBeVisible();
  await page.getByTestId('line-reply').tap();
  await expect(page.getByTestId('replying')).toContainText('Ed Safari');
  await expect(page.getByLabel('Say something')).toBeFocused();
});

test('a photo and a pair of glasses, on his face at once', async ({ page }) => {
  await comeIn(page, 'Flo Safari');
  await page.getByRole('button', { name: 'Settings' }).tap();
  const face = page.getByTestId('you');
  // Cropped and shrunk in the browser (`prepareFace`): Safari decodes and
  // draws it its own way, and a face it cannot decode is one it cannot show.
  await page.setInputFiles('#face', 'public/icon-192.png');
  await expect(face.locator('img')).toBeVisible();
  await page.getByTestId('glasses-open').tap();
  await page.getByTestId('glasses-picker').getByTestId('glasses-aviators').tap();
  await expect(face.locator('.face-shades')).toHaveAttribute('data-glasses', 'aviators');
});

test('dark, asked for, is dark', async ({ page }) => {
  await comeIn(page, 'Gil Safari');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'Dark' }).tap();
  // The same pinned value as Chromium's check: the page really is dark.
  const bg = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor.replace(/\s/g, ''),
  );
  expect(bg).toBe('rgb(18,19,20)');
});

test('a photograph opens in the app, and closes back to the room', async ({ page }) => {
  await comeIn(page, 'Hal Safari');
  await talk(page);
  await page.setInputFiles('#attach', 'public/icon-192.png');
  await expect(page.getByTestId('pending-media')).toBeVisible();
  const line = await say(page, 'safari line 04 a picture');
  await line.getByTestId('photo').tap();
  const viewer = page.getByTestId('viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId('viewer-shot')).toBeVisible();
  await viewer.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('main.room')).toHaveAttribute('data-view', 'talk');
});

test('in, straight back out, and in again, in French', async ({ page }) => {
  // The door's dead second press, on the engine where the splash is a
  // masked SVG painted Safari's way — and in the language whose test found it.
  await comeIn(page, 'Ivo Safari');
  await page.getByRole('button', { name: 'Settings' }).tap();
  await page.getByRole('button', { name: 'FR', exact: true }).tap();
  await page.getByRole('button', { name: 'Ferme', exact: true }).tap();
  const room = page.locator('main.room');
  // The clock held still, as in home.spec: the second press lands inside the
  // first film on any machine, instead of only on a fast one — under a loaded
  // full run the film's timing drifted and this failed with nothing wrong.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByTestId('home-go').tap();
  await page.clock.runFor(150);
  await expect(room).toHaveAttribute('data-view', 'talk');
  await page.getByTestId('go-home').tap();
  await expect(room).toHaveAttribute('data-view', 'home');
  await expect(page.getByTestId('splash')).toHaveCount(1);
  await page.getByTestId('home-go').tap();
  await page.clock.runFor(150);
  await expect(room).toHaveAttribute('data-view', 'talk');
  await page.clock.runFor(3000);
  await expect(page.getByTestId('splash')).toHaveCount(0);
});

test('a phone that drops out comes back to what changed', async ({ browser }) => {
  // The change log on WebKit: while this phone's socket is gone, another dad
  // changes a line it holds and marks it; the resume brings both.
  const context = await browser.newContext({ ...devices['iPhone 13'] });
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
  const phone = await context.newPage();
  await comeIn(phone, 'Jo Safari');
  await talk(phone);

  const other = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  await comeIn(other, 'Kit Safari');
  await talk(other);
  const his = await say(other, 'safari line 05 before the tunnel');
  await expect(phone.getByTestId('line').filter({ hasText: 'safari line 05' })).toBeVisible();

  down = true;
  for (const ws of live.splice(0)) await ws.close();

  await longPress(his.locator('.body'));
  await other.getByTestId('line-edit').tap();
  await other.getByLabel('Say something').fill('safari line 05 after the tunnel');
  await other.getByRole('button', { name: 'Send' }).tap();
  const changed = other.getByTestId('line').filter({ hasText: 'after the tunnel' });
  await expect(changed).toBeVisible();
  await changed.locator('.body').tap();
  await changed.getByTestId('tap-marks').getByTestId('react-🙏').tap();
  await expect(changed.getByTestId('mark').filter({ hasText: '🙏' })).toContainText('1');

  down = false;
  const back = phone.getByTestId('line').filter({ hasText: 'after the tunnel' });
  await expect(back).toBeVisible({ timeout: 20_000 });
  await expect(back.getByTestId('mark').filter({ hasText: '🙏' })).toContainText('1');

  await other.context().close();
  await context.close();
});
