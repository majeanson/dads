import { expect, test, type Page } from '@playwright/test';
import { home, menu, talk } from './talk';
import { E2E_PREFS_GROUP } from './global-setup';

// One group, and each test brings its own dad.
test.describe.configure({ mode: 'serial' });

async function comeIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_PREFS_GROUP.code);
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

  // And the conversation stayed the conversation.
  await talk(marc);
  await expect(marc.getByTestId('line')).toHaveCount(0);

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
  // The questions are on home too — the day's thing to do.
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
  await expect(page.getByLabel('Code')).toBeVisible();

  await page.getByRole('button', { name: 'FR', exact: true }).click();
  await expect(page.getByLabel('Ton nom')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entre' })).toBeVisible();

  // And the door remembers, so the room he walks into is already French.
  await page.getByLabel('Code').fill(E2E_PREFS_GROUP.code);
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
  await expect(samPage.getByTestId('line')).toHaveCount(0);

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
  await page.getByTestId('glasses-open').click();
  await expect(picker.getByTestId('glasses-aviators')).toHaveAttribute('aria-pressed', 'true');
  // And the pair he chose is ON him — choosing that changed nothing on his
  // face read as choosing that did nothing.
  await expect(worn).toHaveAttribute('data-glasses', 'aviators');

  await page.reload();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await page.getByRole('button', { name: 'Settings' }).click();
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
