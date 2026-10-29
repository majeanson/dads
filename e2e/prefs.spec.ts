import { expect, test, type Page } from '@playwright/test';
import { home, menu, talk } from './talk';
import { E2E_PREFS_GROUP } from './global-setup';

// One group, and each test brings its own dad.
test.describe.configure({ mode: 'serial' });

async function comeIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('The word').fill(E2E_PREFS_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
}

test('a dad reads the room in French, and it stays French', async ({ page }) => {
  await comeIn(page, 'Marc');

  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'FR', exact: true }).click();

  // The whole app turns over: the sheet he is standing in, home behind it,
  // and the conversation and its menu behind that.
  await expect(page.getByTestId('settings')).toContainText('Sur cet appareil');
  await page.getByRole('button', { name: 'Ferme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Réglages' })).toBeVisible();
  await expect(page.getByTestId('connection')).toHaveText(/ici$/);
  await talk(page);
  await menu(page);
  await expect(page.getByRole('button', { name: 'Ouvre la table' })).toBeVisible();
  await page.getByRole('button', { name: 'Ferme', exact: true }).click();
  await expect(page.getByLabel('Dis quelque chose')).toBeVisible();

  // Including the page's own language, which is what a screen reader and a
  // spellchecker both read.
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');

  // It survives a reload: the choice is the device's, not the tab's.
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');
  await expect(page.getByTestId('connection')).toHaveText(/ici$/);
  await talk(page);

  // And back again.
  await home(page);
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByTestId('settings')).toContainText('On this device');
});

test('a dad asks for dark, and gets dark', async ({ page }) => {
  await comeIn(page, 'Sam');

  // Nothing is stamped on the page until he asks: the phone decides.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();

  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

  // The page really is dark, not just labelled dark.
  const dark = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor.replace(/\s/g, ''),
  );
  // --bg, dark. Pinned as a value rather than "not white": the theme-color
  // metas and the manifest carry the same hex by hand, and a palette change
  // that misses one of them is exactly what this is here to catch.
  expect(dark).toBe('rgb(18,19,20)');

  // Stamped before the first paint by the shell's own script, so there is no
  // white flash on the way into the room — not after React has mounted.
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);

  // Handing it back to the phone takes the stamp off again.
  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Follow the phone' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
});

test('the app’s own words follow each dad, in the room they share', async ({ browser }) => {
  // The room writes no lines of its own any more, so there is no sentence in
  // the conversation left to translate. What is still two languages in one
  // room is everything the APP says — the night on home, the menu's rows, the
  // week — and it is per dad and per device rather than per group.
  const fr = await browser.newContext();
  const en = await browser.newContext();
  const marc = await fr.newPage();
  const sam = await en.newPage();

  await comeIn(marc, 'Marc');
  await comeIn(sam, 'Sam');

  await home(marc);
  await marc.getByRole('button', { name: 'Settings' }).click();
  await marc.getByRole('button', { name: 'FR', exact: true }).click();

  // Marc sets the night, in French, from home's card.
  await marc.getByRole('button', { name: 'Ferme', exact: true }).click();
  await marc.getByTestId('dad-night').click();
  await marc.getByTestId('night-standing').click();
  await marc.getByLabel('Jour', { exact: true }).selectOption('4');
  await marc.getByLabel('Heure', { exact: true }).fill('21:00');
  await marc.getByRole('button', { name: 'Enregistre' }).click();
  await marc.getByRole('button', { name: 'Ferme', exact: true }).click();

  // One night, two screens, two languages — and Sam was told without being
  // sent a sentence: the frame carried the night, and his own app says it in
  // his own words.
  await expect(marc.getByTestId('home-when')).toContainText('jeudi', { ignoreCase: true });
  await expect(sam.getByTestId('home-when')).toContainText('Thursday', { timeout: 15_000 });

  // And the conversation stayed the conversation: nothing about the night in
  // it, in either language. Not "no lines at all" — this room is shared with
  // the rest of the file, and a retry of it runs after tests that talk.
  await talk(marc);
  await expect(marc.getByTestId('line').filter({ hasText: /jeudi|thursday|21:00/i })).toHaveCount(
    0,
  );

  await fr.close();
  await en.close();
});

test('the day’s question is asked in the language it is read in', async ({ page }) => {
  await comeIn(page, 'Dave');

  await menu(page);
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Questions/ })
    .click();
  const english = await page.getByTestId('prompt-body').textContent();

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await page.getByRole('button', { name: 'Ferme', exact: true }).click();
  await menu(page);
  await page
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Les questions/ })
    .click();
  const french = await page.getByTestId('prompt-body').textContent();

  // The same question, and not the same words: one pool, one pick, two texts,
  // so a dad reading in French answers the question the others answered.
  expect(french).not.toBe(english);
  expect(french!.length).toBeGreaterThan(10);
});

test('a francophone can say so at the door, before he is anybody', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('The word')).toBeVisible();

  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(page.getByLabel('Ton nom')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entre' })).toBeVisible();

  // And the door remembers, so the room he walks into is already French.
  await page.getByLabel('Le mot').fill(E2E_PREFS_GROUP.code);
  await page.getByLabel('Ton nom').fill('Luc');
  await page.getByRole('button', { name: 'Entre' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/ici$/);
  await talk(page);
});

test('the phone’s own chrome follows the theme it was asked for', async ({ page }) => {
  await comeIn(page, 'Théo');

  const bar = () =>
    page.evaluate(
      () =>
        document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute('content') ??
        null,
    );

  // Nothing fixed while the phone decides: the media-query pair holds.
  expect(await bar()).toBeNull();

  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  expect(await bar()).toBe('#121314');

  await page.getByRole('button', { name: 'Light' }).click();
  expect(await bar()).toBe('#fcfcfb');

  await page.getByRole('button', { name: 'Follow the phone' }).click();
  expect(await bar()).toBeNull();
});

test('a dad changes the name he goes by, and the roster follows', async ({ browser }) => {
  const marc = await browser.newContext();
  const marcPage = await marc.newPage();
  await comeIn(marcPage, 'Gus');
  const sam = await browser.newContext();
  const samPage = await sam.newPage();
  await comeIn(samPage, 'Hank');

  await home(marcPage);
  await marcPage.getByRole('button', { name: 'Settings' }).click();
  await marcPage.getByTestId('my-name').fill('Gus-antoine');
  await marcPage.getByTestId('you').getByRole('button', { name: 'Save' }).click();

  // Who is who is the roster's job, and it changes without anybody
  // reconnecting. The room used to say it in a line as well; that was the
  // room talking about itself, one tap from the screen that answers it.
  await samPage.getByTestId('connection').click();
  await expect(samPage.getByTestId('roster-entry').filter({ hasText: 'Gus-antoine' })).toBeVisible({
    timeout: 15_000,
  });
  // Nothing said about it: not "no lines at all", which this shared room
  // cannot promise once the file has been retried, but no line naming him.
  await expect(samPage.getByTestId('line').filter({ hasText: /Gus/ })).toHaveCount(0);

  await marc.close();
  await sam.close();
});

test('a dad with no photo is his colour, his glasses and a smile', async ({ page }) => {
  await comeIn(page, 'Ivan Nash');
  await page.getByTestId('connection').click();
  // Never an empty grey circle, and no letters: the glasses sat across them.
  // A face with nothing written on it — the name is beside it.
  const entry = page.getByTestId('roster-entry').filter({ hasText: 'Ivan Nash' });
  await expect(entry.locator('.face-smile')).toHaveCount(1);
  await expect(entry.locator('.face-shades')).toHaveAttribute('data-glasses', 'shades');
  await expect(entry).not.toContainText('IN');
});

test('a photo he has just added wears his glasses, and a new pair lands on it', async ({
  page,
}) => {
  // Without closing Settings: the picture he just chose was a bare preview,
  // and the glasses only appeared on it after the sheet was reopened.
  await comeIn(page, 'Ugo Snap');
  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const face = page.getByTestId('you');

  await page.getByTestId('look-open').click();
  await page.setInputFiles('#face', 'public/icon-192.png');
  await expect(face.locator('img')).toBeVisible();
  await expect(face.locator('.face-shades')).toHaveAttribute('data-glasses', 'shades');

  await page.getByTestId('glasses-open').click();
  await page.getByTestId('glasses-picker').getByTestId('glasses-round').click();
  await expect(face.locator('img')).toBeVisible();
  await expect(face.locator('.face-shades')).toHaveAttribute('data-glasses', 'round');
  // The button and the picture read the same list, so they agree.
  await expect(face.getByText('Change it')).toBeVisible();

  // Taking it off: the picture goes and stays gone. It used to come back for
  // a moment — the room's copy, until the room caught up — and the button
  // could say "Take it off" beside a face with no photo on it.
  await face.getByRole('button', { name: 'Take it off' }).click();
  await expect(face.locator('img')).toHaveCount(0);
  await expect(face.getByText('Add a face')).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(200);
    await expect(face.locator('img')).toHaveCount(0);
  }
  await expect(face.locator('.face-shades')).toHaveAttribute('data-glasses', 'round');
});

test('he fits his glasses to his photo, and every face of his wears them there', async ({
  page,
}) => {
  await comeIn(page, 'Vic Fit');
  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();

  // With no photo there is nothing to fit: a colour face is drawn to fit.
  await page.getByTestId('look-open').click();
  await page.getByTestId('glasses-open').click();
  await expect(page.getByTestId('glasses-picker')).toBeVisible();
  await expect(page.getByTestId('glasses-fit')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.setInputFiles('#face', 'public/icon-192.png');
  const face = page.getByTestId('you');
  await expect(face.locator('img')).toBeVisible();

  await page.getByTestId('glasses-open').click();
  await page.getByTestId('glasses-fit').click();
  const fitter = page.getByTestId('glasses-fitter');
  await expect(fitter).toBeVisible();
  const area = fitter.getByTestId('fit-area');
  await expect(area).toHaveAttribute('data-fit', '0,0,1');

  // A drag moves them — down and to the right, by a share of the face.
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 14, box.y + box.height / 2 + 22, { steps: 5 });
  await page.mouse.up();
  const dragged = (await area.getAttribute('data-fit'))!.split(',').map(Number);
  expect(dragged[0]).toBeGreaterThan(0.05);
  expect(dragged[1]).toBeGreaterThan(0.1);

  // The keys move them too, and the slider sizes them.
  await area.focus();
  await page.keyboard.press('ArrowUp');
  const keyed = (await area.getAttribute('data-fit'))!.split(',').map(Number);
  expect(keyed[1]).toBeCloseTo(dragged[1]! - 0.01, 3);
  await fitter.getByTestId('fit-size').fill('1.3');
  await expect(area).toHaveAttribute('data-fit', /,1\.3$/);

  await fitter.getByTestId('fit-save').click();
  await expect(fitter).toHaveCount(0);

  // Not optimistic: his face in Settings wears them where he put them once
  // the room has it — and so does the face beside what he says.
  const worn = face.locator('.face-shades');
  await expect(worn).toHaveCSS('scale', '1.3');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await talk(page);
  await page.getByLabel('Say something').fill('fitted at last');
  await page.getByRole('button', { name: 'Send' }).click();
  const line = page.getByTestId('line').filter({ hasText: 'fitted at last' });
  await expect(line.locator('.face-shades')).toHaveCSS('scale', '1.3');
});

test('a dad chooses his glasses, and they stay his', async ({ page }) => {
  await comeIn(page, 'Ivo Frames');
  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();

  // The app's shades until he chooses. One button beside his face opens the
  // six.
  await page.getByTestId('look-open').click();
  await page.getByTestId('glasses-open').click();
  const picker = page.getByTestId('glasses-picker');
  await expect(picker.getByTestId('glasses-shades')).toHaveAttribute('aria-pressed', 'true');
  // Each of the six is him wearing it — his face, with that pair on — not
  // the pair on its own.
  for (const kind of ['shades', 'aviators', 'round', 'square', '3d', 'goggles']) {
    const option = picker.getByTestId(`glasses-${kind}`);
    await expect(option.locator('.face-smile')).toHaveCount(1);
    await expect(option.locator('.face-shades')).toHaveAttribute('data-glasses', kind);
  }

  // Not optimistic: the pair is his when the room has it, and every screen
  // hears it the same way — including this one.
  // His face has the shades on before he chooses anything: they are part of
  // every face, not a sign he is coming.
  const worn = page.getByTestId('you').locator('.face-shades');
  await expect(worn).toHaveAttribute('data-glasses', 'shades');

  await picker.getByTestId('glasses-aviators').click();
  // The picker closes once the room has the pair. Reopening before that
  // pressed the button of a popover that was still open — which closes it —
  // and the save then closed it too, leaving nothing to look in. CI found it.
  await expect(picker).toHaveCount(0);
  await page.getByTestId('glasses-open').click();
  await expect(picker.getByTestId('glasses-aviators')).toHaveAttribute('aria-pressed', 'true');
  // And the pair he chose is ON him — choosing that changed nothing on his
  // face read as choosing that did nothing.
  await expect(worn).toHaveAttribute('data-glasses', 'aviators');

  await page.reload();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('look-open').click();
  await page.getByTestId('glasses-open').click();
  await expect(page.getByTestId('glasses-aviators')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Beside what he says, too.
  await talk(page);
  await page.getByLabel('Say something').fill('new frames tonight');
  await page.getByRole('button', { name: 'Send' }).click();
  const line = page.getByTestId('line').filter({ hasText: 'new frames tonight' });
  await expect(line.locator('.face-shades')).toHaveAttribute('data-glasses', 'aviators');
});

test('whoever won the last game wears gold, and the roster says so', async ({ page }) => {
  // The frame the table relays when a game ends, sent the way a framed dad's
  // browser sends it — over the room's socket — because a real jaffre cannot
  // be framed here. The bridge itself is jaffre's embed test and dads' parse.
  await comeIn(page, 'Zed Winner');
  await talk(page);
  await page.getByLabel('Say something').fill('good game all');
  await page.getByRole('button', { name: 'Send' }).click();
  const line = page.getByTestId('line').filter({ hasText: 'good game all' });
  await expect(line.locator('.face-shades')).not.toHaveClass(/face-champion/);

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
        ws.onmessage = (e) => {
          if (typeof e.data === 'string' && e.data.includes('"t":"hello"')) {
            ws.send(
              JSON.stringify({
                t: 'table',
                event: { v: 1, t: 'game-over', summary: '41–37, Sun win', winners: ['Zed Winner'] },
              }),
            );
            setTimeout(() => {
              ws.close();
              resolve();
            }, 300);
          }
        };
      }),
  );

  // Gold, on every face of his: beside what he said, and in the header.
  await expect(line.locator('.face-shades')).toHaveClass(/face-champion/);
  // A screen reader cannot see a gold pair; the roster tells it.
  await page.getByTestId('connection').click();
  await expect(page.getByTestId('roster-entry').filter({ hasText: 'Zed Winner' })).toContainText(
    'who won the last game',
  );
});

test('he picks his colour, is told what it changes, and can go back to automatic', async ({
  page,
}) => {
  await comeIn(page, 'Colourful');
  await home(page);
  await page.getByTestId('home-settings').click();

  // Its own control beside his name, and it says what it changes.
  await page.getByTestId('colour-open').click();
  await expect(page.getByTestId('colour-what')).toContainText('your name');
  await expect(page.getByTestId('colour-what')).toContainText('quote');
  await expect(page.getByTestId('colour-picker').getByRole('button')).toHaveCount(12);

  // One of the new ones, and it is on the face at once.
  await page.getByTestId('colour-11').click();
  await expect(page.getByTestId('colour-11')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('you').locator('.face-blank, .face').first()).toHaveCSS(
    '--dad',
    // --dad-11 in the light palette, or in the dark one.
    /#7a4e2d|#d9b08c/i,
  );

  // And it is his on a reload: it lives in the room, not the tab.
  await page.reload();
  await page.getByTestId('home-settings').click();
  await page.getByTestId('colour-open').click();
  await expect(page.getByTestId('colour-11')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('colour-auto').click();
  await expect(page.getByTestId('colour-auto')).toHaveCount(0);
  await expect(page.getByTestId('colour-11')).toHaveAttribute('aria-pressed', 'false');
});

test('a new device asks with a code and comes in as the same dad', async ({ browser }) => {
  const first = await (await browser.newContext()).newPage();
  await comeIn(first, 'Pia Phone');

  // The home-screen app: nothing stored, so it is a stranger at the door.
  const second = await (await browser.newContext()).newPage();
  await second.goto('/');
  await second.getByTestId('pair-start').click();
  await expect(second.getByTestId('pair-code')).toHaveText(/^[A-Z2-9]{8}$/);
  const code = (await second.getByTestId('pair-code').textContent()) ?? '';

  // From Settings, beside the other things about a phone.
  await home(first);
  await first.getByTestId('home-settings').click();
  await first.getByTestId('settings-link').click();
  await first.getByTestId('pair-code-in').fill(code.toLowerCase());
  await first.getByRole('button', { name: 'Let it in' }).click();
  await expect(first.getByTestId('pair-done')).toBeVisible();

  // And the second device is in, as him: his name, not a new dad's.
  await expect(second.getByTestId('connection')).toHaveText(/here$/, { timeout: 15_000 });
  await second.getByRole('button', { name: 'Settings' }).click();
  await expect(second.getByTestId('my-name')).toHaveValue('Pia Phone');

  await first.context().close();
  await second.context().close();
});

test('the home-screen app leads with the way in as himself', async ({ browser }) => {
  // A phone that has added the app: Safari's own flag, which is the one that
  // is true on an iPhone.
  const app = await (await browser.newContext()).newPage();
  await app.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await app.goto('/');
  const nudge = app.getByTestId('pair-nudge');
  await expect(nudge).toBeVisible();
  // The one button, and it asks for a code rather than making a second dad.
  await expect(app.getByTestId('pair-start')).toHaveCount(1);
  await nudge.getByTestId('pair-start').click();
  await expect(app.getByTestId('pair-code')).toHaveText(/^[A-Z2-9]{8}$/);

  // In a browser tab nothing leads: the form is the door, the button is quiet.
  const tab = await (await browser.newContext()).newPage();
  await tab.goto('/');
  await expect(tab.getByTestId('pair-nudge')).toHaveCount(0);
  await expect(tab.getByTestId('pair-start')).toHaveCount(1);

  await app.context().close();
  await tab.context().close();
});

/**
 * Quiet hours and a pause (2026-10-29).
 *
 * The reminder switch only exists where a browser can subscribe to push,
 * which headless Chromium cannot do against a real push service, so the page
 * is told it already has a subscription and the server is told it knows it.
 * What is proved is the screen and the route behind it; whether a phone
 * really stays quiet is `test/quiet-route.test.ts`, on the real rows.
 */
async function withReminderOn(page: Page) {
  await page.addInitScript(() => {
    // Headless Chromium reports notifications as denied, which the app rightly
    // reads as "blocked" and offers nothing; granting it by the context does not
    // change what the page reads.
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    PushManager.prototype.getSubscription = async () =>
      ({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-quiet' }) as PushSubscription;
  });
  await page.route('**/api/push?*', (route) =>
    route.fulfill({ json: { key: 'e2e', known: true } }),
  );
}

test('a dad pauses his notifications, sets quiet hours, and both are still there after a reload', async ({
  page,
}) => {
  await withReminderOn(page);
  await comeIn(page, 'Quiet Marc');
  await home(page);
  await page.getByTestId('home-settings').click();

  // Offered only once the reminder is on, and folded: its label says what is
  // in force, so he need not open it to know.
  const fold = page.getByTestId('quiet-open');
  await expect(fold).toHaveText('Quiet hours and pause');
  await fold.click();

  // A pause: one tap, and the label and the sheet both say until when.
  await page.getByTestId('quiet-pause-8h').click();
  await expect(page.getByTestId('quiet-paused')).toContainText('Paused until');
  await expect(fold).toContainText('Paused until');
  await expect(page.getByTestId('quiet-pause-1h')).toHaveCount(0);

  // It survives a reload: it is the server's, not the page's.
  await page.reload();
  await page.getByTestId('home-settings').click();
  await expect(page.getByTestId('quiet-open')).toContainText('Paused until');

  // Resume, and the three pauses are back.
  await page.getByTestId('quiet-open').click();
  await page.getByTestId('quiet-resume').click();
  await expect(page.getByTestId('quiet-pause-1h')).toBeVisible();
  await expect(page.getByTestId('quiet-open')).toHaveText('Quiet hours and pause');

  // Quiet hours: a night's sleep to start from, then his own times.
  await page.getByTestId('quiet-window').click();
  await expect(page.getByTestId('quiet-from')).toHaveValue('22:00');
  await expect(page.getByTestId('quiet-to')).toHaveValue('07:00');
  await page.getByTestId('quiet-from').fill('23:30');
  await expect(page.getByTestId('quiet-open')).toContainText('Quiet 23:30–07:00');

  // The server holds what the screen shows, in his own zone.
  const saved = await page.evaluate(() => fetch('/api/quiet').then((r) => r.json()));
  expect(saved).toMatchObject({ from: '23:30', to: '07:00' });
  expect(typeof saved.tz).toBe('string');

  // And turning it off clears it.
  await page.getByTestId('quiet-window').click();
  await expect(page.getByTestId('quiet-from')).toHaveCount(0);
  await expect(page.getByTestId('quiet-open')).toHaveText('Quiet hours and pause');
});

test('quiet hours are not offered until the reminder is on, and read in French', async ({
  page,
  browser,
}) => {
  await comeIn(page, 'Quiet Off');
  await home(page);
  await page.getByTestId('home-settings').click();
  await expect(page.getByTestId('quiet-open')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // A dad of his own: a page in this context would already be Quiet Off.
  const fr = await (await browser.newContext()).newPage();
  await withReminderOn(fr);
  await comeIn(fr, 'Quiet Fr');
  await fr.evaluate(() => localStorage.setItem('dads.lang', 'fr'));
  await fr.reload();
  await home(fr);
  await fr.getByTestId('home-settings').click();
  await expect(fr.getByTestId('quiet-open')).toHaveText('Heures calmes et pause');
});

test('his own face wears the fit even when the room answers before the upload does', async ({
  page,
}) => {
  // The room's `member` frame often beats the upload's own response by a few
  // milliseconds; held back here so it always does. The picture he just chose
  // used to be kept as a preview after the room had caught up, and a preview
  // is drawn WITHOUT his fit, so his face in Settings never wore it.
  await page.route('**/api/me/face', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({ response });
  });
  await comeIn(page, 'Vic Late');
  await home(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('look-open').click();
  await page.setInputFiles('#face', 'public/icon-192.png');
  const face = page.getByTestId('you');
  await expect(face.locator('img')).toBeVisible();
  // Let the delayed response land: `busy` is off once the upload has settled.
  await expect(page.getByTestId('glasses-open')).toBeEnabled();
  await page.waitForTimeout(1200);

  await page.getByTestId('glasses-open').click();
  await page.getByTestId('glasses-fit').click();
  const fitter = page.getByTestId('glasses-fitter');
  await fitter.getByTestId('fit-size').fill('1.3');
  await fitter.getByTestId('fit-save').click();
  await expect(fitter).toHaveCount(0);

  await expect(face.locator('.face-shades')).toHaveCSS('scale', '1.3');
});
