import { expect, test, type Page } from '@playwright/test';
import { talk } from './talk';
import { E2E_FRESH_GROUP } from './global-setup';

/**
 * A dad on the home screen gets the new version without being asked to.
 *
 * The app is put to sleep and woken for days at a time; what wakes is the
 * build he opened last week. So coming back to the foreground asks the door
 * which build it is serving now, and reloads when the answer has changed —
 * unless he is in the middle of something.
 *
 * "Coming back" is driven here as a page restored from the browser's cache
 * (`pageshow` with `persisted`), which is one of the two ways an old page
 * wakes and the only one a test can fire. The other, visibility, runs the
 * same check. Each test is its own page because the check asks the door at
 * most once a minute, and a test that asked twice would be testing the
 * throttle.
 */
test.describe.configure({ mode: 'serial' });

async function comeIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Code').fill(E2E_FRESH_GROUP.code);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Come in' }).click();
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
  await page.evaluate(() => {
    (window as unknown as { stillTheOldPage: boolean }).stillTheOldPage = true;
  });
}

/** From now on, the door names a build that is not the one running. */
async function deployNewBuild(page: Page) {
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      // Only the app's own check, never a navigation: the reload that follows
      // must land on the real page or it would loop.
      if (route.request().resourceType() !== 'fetch') return route.continue();
      const res = await route.fetch();
      const html = (await res.text()).replace(
        /\/assets\/index-[^"]+\.js/,
        '/assets/index-NEWBUILD.js',
      );
      await route.fulfill({ response: res, body: html });
    },
  );
}

async function comeBack(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
}

const stillOld = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { stillTheOldPage?: boolean }).stillTheOldPage === true,
  );

const reloaded = (page: Page) =>
  page.waitForFunction(() => !(window as unknown as { stillTheOldPage?: boolean }).stillTheOldPage);

test('coming back to the same build changes nothing', async ({ page }) => {
  await comeIn(page, 'Marc');
  await comeBack(page);
  await page.waitForTimeout(700);
  expect(await stillOld(page)).toBe(true);
});

test('coming back to a newer build reloads the room', async ({ page }) => {
  await comeIn(page, 'Sam');
  await deployNewBuild(page);
  await comeBack(page);
  await reloaded(page);
  // Reloaded into the same room, still him: the cookie and the device token
  // carried him through.
  await expect(page.getByTestId('connection')).toHaveText(/here$/);
  await talk(page);
});

test('a line half typed holds the new build back until his hands are free', async ({ page }) => {
  await comeIn(page, 'Dave');
  await page.getByLabel('Say something').fill('half a thou');

  await deployNewBuild(page);
  await comeBack(page);
  await page.waitForTimeout(700);
  expect(await stillOld(page)).toBe(true);
  await expect(page.getByLabel('Say something')).toHaveValue('half a thou');

  // Sent. The next return reloads — inside the minute, so without asking the
  // door again: it remembers what it was told.
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByLabel('Say something')).toHaveValue('');
  await comeBack(page);
  await reloaded(page);
  // A reload lands on home, like every cold open does.
  await talk(page);
  await expect(page.getByTestId('line').filter({ hasText: 'half a thou' })).toBeVisible();
});
