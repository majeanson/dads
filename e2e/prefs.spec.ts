import { expect, test, type Page } from '@playwright/test';
import { E2E_PREFS_GROUP } from './global-setup';

// One group, and each test brings its own dad.
test.describe.configure({ mode: 'serial' });

async function comeIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_PREFS_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
}

test('a dad reads the room in French, and it stays French', async ({ page }) => {
  await comeIn(page, 'Marc');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'FR', exact: true }).click();

  // The whole app turns over, menu and room both.
  await expect(page.getByRole('button', { name: 'Ouvre la table' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toBeVisible();
  await page.getByRole('button', { name: 'Ferme', exact: true }).click();
  await expect(page.getByTestId('connection')).toHaveText(/ici$/);
  await expect(page.getByLabel('Dis quelque chose')).toBeVisible();

  // Including the page's own language, which is what a screen reader and a
  // spellchecker both read.
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');

  // It survives a reload: the choice is the device's, not the tab's.
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');
  await expect(page.getByTestId('connection')).toHaveText(/ici$/);

  // And back again.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('a dad asks for dark, and gets dark', async ({ page }) => {
  await comeIn(page, 'Sam');

  // Nothing is stamped on the page until he asks: the phone decides.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

  // The page really is dark, not just labelled dark.
  const dark = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor.replace(/\s/g, ''),
  );
  expect(dark).toBe('rgb(19,18,17)');

  // Stamped before the first paint by the shell's own script, so there is no
  // white flash on the way into the room — not after React has mounted.
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await expect(page.getByTestId('connection')).toHaveText(/here$/);

  // Handing it back to the phone takes the stamp off again.
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Follow the phone' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
});
