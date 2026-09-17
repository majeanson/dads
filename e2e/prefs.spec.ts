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

test('what the room says about itself is read in each dad’s own language', async ({ browser }) => {
  // Two dads, same room, different languages — the point of translating the
  // room's own lines rather than archiving a sentence.
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
  await marc.getByLabel('Jour').selectOption('4');
  await marc.getByLabel('Heure').fill('21:00');
  await marc.getByRole('button', { name: 'Enregistre' }).click();
  await marc.getByRole('button', { name: 'Ferme', exact: true }).click();
  await talk(marc);

  // The same event, two rooms, two languages.
  await expect(
    marc.getByTestId('line').filter({ hasText: 'a mis la soirée de gars les jeudis à 21:00' }),
  ).toBeVisible();
  await expect(
    sam.getByTestId('line').filter({ hasText: 'set dad night to Thursdays at 21:00' }),
  ).toBeVisible();

  // And Sam switching over re-reads the line he already has.
  await home(sam);
  await sam.getByRole('button', { name: 'Settings' }).click();
  await sam.getByRole('button', { name: 'FR', exact: true }).click();
  await sam.getByRole('button', { name: 'Ferme', exact: true }).click();
  await talk(sam);
  await expect(
    sam.getByTestId('line').filter({ hasText: 'a mis la soirée de gars les jeudis à 21:00' }),
  ).toBeVisible();

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

test('a dad changes the name he goes by, and the others are told', async ({ browser }) => {
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

  // The other dad hears it by name rather than watching a stranger appear in
  // the roster.
  await expect(
    samPage.getByTestId('line').filter({ hasText: 'Gus goes by Gus-antoine now' }),
  ).toBeVisible();

  // And the roster changes without anybody reconnecting.
  await samPage.getByTestId('connection').click();
  await expect(
    samPage.getByTestId('roster-entry').filter({ hasText: 'Gus-antoine' }),
  ).toBeVisible();

  await marc.close();
  await sam.close();
});

test('a dad with no face still gets his initials', async ({ page }) => {
  await comeIn(page, 'Ivan Nash');
  await page.getByTestId('connection').click();
  // Never an empty grey circle: the whole point is telling five men apart,
  // and a blank is worse at that than two letters.
  await expect(page.getByTestId('roster-entry').filter({ hasText: 'Ivan Nash' })).toContainText(
    'IN',
  );
});
