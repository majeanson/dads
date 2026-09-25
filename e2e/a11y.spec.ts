import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { talk } from './talk';
import { E2E_A11Y_GROUP } from './global-setup';

/**
 * Every scene a dad stands in, checked by axe.
 *
 * Not a substitute for using it with a screen reader, but it is the part of
 * that which a machine can do: a control with no name, a field with no label,
 * text that cannot be read against its background, a dialog that does not
 * say it is one. Serious and critical only — the rest is advice, and advice
 * does not fail a build.
 *
 * Both themes, because the dark palette is a second set of pairs.
 */
test.describe.configure({ mode: 'serial' });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function faults(page: Page, scene: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${scene}: ${v.id} (${v.impact}) — ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n'),
    );
}

for (const theme of ['light', 'dark'] as const) {
  test(`every scene reads, in ${theme}`, async ({ browser }) => {
    test.setTimeout(90_000);
    // Reduced motion, so every scene is read at rest. A line easing in or a
    // sheet rising is half-transparent for a quarter of a second, and axe
    // measuring contrast mid-fade reports colours nobody ever sits and reads.
    const context = await browser.newContext({ colorScheme: theme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const found: string[] = [];

    await page.goto('/');
    found.push(...(await faults(page, 'the door')));

    await page.getByLabel('Code').fill(E2E_A11Y_GROUP.code);
    await page.getByLabel('Your name').fill(theme === 'light' ? 'Marc' : 'Sam');
    await page.getByRole('button', { name: 'Come in' }).click();
    await expect(page.getByTestId('connection')).toHaveText(/here$/);
    // Home is where the app opens, so it is a scene like any other.
    found.push(...(await faults(page, 'home')));
    await talk(page);

    // One of everything in the conversation so the rows are checked too.
    // Named for the theme: both runs share one room, and a line that reads
    // the same twice is two elements to a locator.
    await page
      .getByLabel('Say something')
      .fill(`a ${theme} line with a link https://example.com in it`);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('line').filter({ hasText: `a ${theme} line` })).toBeVisible();
    found.push(...(await faults(page, 'the room')));

    // And a photograph, which is a line with a control on it and a screen of
    // its own behind that.
    await page.setInputFiles('#attach', 'public/icon-192.png');
    await page.getByLabel('Say something').fill(`a ${theme} photo`);
    await page.getByRole('button', { name: 'Send' }).click();
    const shot = page.getByTestId('line').filter({ hasText: `a ${theme} photo` });
    await expect(shot).toBeVisible();
    await shot.getByTestId('photo').click();
    await expect(page.getByTestId('viewer')).toBeVisible();
    found.push(...(await faults(page, 'a photo, full screen')));
    await page.keyboard.press('Escape');

    const menu = () => page.getByRole('button', { name: 'Menu' }).click();
    const close = () => page.getByRole('button', { name: 'Close', exact: true }).first().click();
    // A sheet is ready to scan once it is on the screen and has stopped
    // moving — waited for, not guessed at.
    const settled = async () => {
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.evaluate(() =>
        Promise.all(document.getAnimations().map((an) => an.finished.catch(() => undefined))),
      );
    };

    await menu();
    found.push(...(await faults(page, 'the menu')));
    await close();

    await page.getByTestId('connection').click();
    found.push(...(await faults(page, 'who is here')));
    await close();

    // What the conversation's menu holds.
    const chat: [string, RegExp][] = [
      ['the questions', /^Questions/],
      ['the week, from the conversation', /^The week/],
      ['finding a line', /^Find something/],
    ];
    for (const [scene, name] of chat) {
      await menu();
      await page.getByRole('button', { name }).click();
      await settled();
      found.push(...(await faults(page, scene)));
      await close();
    }

    // The two screens behind those: what was asked before, and the weeks
    // behind this one.
    await menu();
    await page.getByRole('button', { name: /^Questions/ }).click();
    await page.getByTestId('prompt-history').click();
    await settled();
    found.push(...(await faults(page, 'asked before')));
    await close();
    await menu();
    await page.getByRole('button', { name: /^The week/ }).click();
    await page.getByTestId('board-tab-before').click();
    await settled();
    found.push(...(await faults(page, 'the weeks before')));
    await close();

    // And what home holds: the night, from its card, and the rows under the
    // door.
    await page.getByTestId('go-home').click();
    await page.getByTestId('dad-night').click();
    await settled();
    found.push(...(await faults(page, 'dad night')));
    await close();

    const rows: [string, RegExp][] = [
      ['the week', /^The week/],
      ['settings', /^Settings/],
      ['the invite', /^Invite a dad/],
    ];
    for (const [scene, name] of rows) {
      await page.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name }).click();
      await settled();
      found.push(...(await faults(page, scene)));
      await close();
    }

    // A line's own menu: marks, reply, edit, copy, take it back.
    await page.getByTestId('home-go').click();
    await page
      .getByTestId('line')
      .filter({ hasText: `a ${theme} line` })
      .click({ button: 'right' });
    await expect(page.getByTestId('line-menu')).toBeVisible();
    found.push(...(await faults(page, 'a line’s menu')));
    await page.keyboard.press('Escape');
    await page.getByTestId('go-home').click();

    // Home in its other two shapes. With no night and days voted on, the card
    // is a list of calendar leaves; with a night and an answer, it is the
    // three-segment control. The door opened on neither.
    const night = (body: unknown) =>
      page.evaluate(
        (b) =>
          fetch('/api/night', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ night: b }),
          }),
        body,
      );
    await night(null);
    const soon = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    await page.evaluate(
      (day) =>
        fetch('/api/poll', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day, answer: 'in' }),
        }),
      soon,
    );
    await page.reload();
    await expect(page.getByTestId('home-poll-best')).toBeVisible();
    found.push(...(await faults(page, 'home, asking when the next one is')));
    await night({ weekday: 4, time: '21:00', tz: 'America/Montreal' });
    await expect(page.getByTestId('home-when')).toBeVisible();
    await page.getByTestId('home-in').click();
    await expect(page.getByTestId('home-in')).toHaveAttribute('aria-pressed', 'true');
    found.push(...(await faults(page, 'home, with a night and an answer')));
    await page.getByTestId('dad-night').click();
    await settled();
    found.push(...(await faults(page, 'dad night, with one on the books')));
    await close();

    // The glasses: the six, and fitting them over a photo. Popovers the rest
    // of this walk never opens.
    await page
      .getByRole('navigation', { name: 'Rooms' })
      .getByRole('button', { name: /^Settings/ })
      .click();
    await settled();
    await page.setInputFiles('#face', 'public/icon-192.png');
    await page.getByTestId('glasses-open').click();
    await expect(page.getByTestId('glasses-picker')).toBeVisible();
    found.push(...(await faults(page, 'the glasses')));
    await page.getByTestId('glasses-fit').click({ timeout: 15_000 });
    await expect(page.getByTestId('glasses-fitter')).toBeVisible();
    found.push(...(await faults(page, 'fitting the glasses')));
    await page.keyboard.press('Escape');
    await close();

    expect(found).toEqual([]);
    await context.close();
  });
}
