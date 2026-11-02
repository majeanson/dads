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
    // The example of a room, which a stranger can open before he has a word.
    await page.getByTestId('door-example').click();
    await expect(page.getByTestId('example')).toBeVisible();
    found.push(...(await faults(page, 'the example')));
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('example')).toHaveCount(0);

    await page.getByLabel('The word').fill(E2E_A11Y_GROUP.code);
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

    // Far up a long conversation, the way back down is a bare arrow
    // (2026-11-02). Enough lines that the top is more than a screen away, on
    // a phone's screen, which is where it is for.
    const wide = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 667 });
    for (let i = 0; i < 20; i++) {
      // Three rows each: a run of one-row lines is short, and twenty of
      // them do not make a phone's screen twice over.
      await page
        .getByLabel('Say something')
        .fill(`${theme} up ${String(i).padStart(2, '0')}\nand\nmore`);
      await page.getByLabel('Say something').press('Enter');
    }
    await expect(page.getByTestId('line').filter({ hasText: `${theme} up 19` })).toBeVisible();
    await page.evaluate(() => {
      document.querySelector('ol.lines')!.scrollTop = 0;
    });
    await expect(page.getByTestId('to-bottom')).toBeVisible();
    found.push(...(await faults(page, 'the way down')));
    await page.getByTestId('to-bottom').click();
    await expect(page.getByTestId('to-bottom')).toHaveCount(0);
    await page.setViewportSize(wide);

    // Tagging a dad: the field points at a listbox while the picks show.
    // The picker lists everybody but him, so the light run (the room's first
    // dad) has nobody to offer and the scene is the dark run's. React has
    // drawn the list by the time `fill` returns, so a missing list is an
    // empty room, not a slow one.
    await page.getByLabel('Say something').fill('@');
    if (await page.getByTestId('tag-picks').isVisible()) {
      found.push(...(await faults(page, 'tagging a dad')));
    }
    await page.getByLabel('Say something').fill('');

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

    // A voice note on a line, with its speed; then the microphone, tapped
    // (the hands-free row) and held (the row that says to slide).
    await page.setInputFiles('#attach', {
      name: 'note.webm',
      mimeType: 'audio/webm',
      buffer: Buffer.alloc(2048),
    });
    await page.getByLabel('Say something').fill(`a ${theme} voice note`);
    await page.getByRole('button', { name: 'Send' }).click();
    const note = page.getByTestId('line').filter({ hasText: `a ${theme} voice note` });
    await expect(note.getByTestId('voice-speed')).toBeVisible();
    found.push(...(await faults(page, 'a voice note')));
    await page.getByTestId('record').click();
    await expect(page.getByRole('button', { name: 'Throw it away' })).toBeVisible();
    found.push(...(await faults(page, 'recording, hands-free')));
    await page.getByRole('button', { name: 'Throw it away' }).click();
    await expect(page.getByTestId('recording')).toHaveCount(0);
    const mic = (await page.getByTestId('record').boundingBox())!;
    await page.mouse.move(mic.x + mic.width / 2, mic.y + mic.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId('recording')).toContainText('Slide left to throw it away');
    found.push(...(await faults(page, 'recording, held')));
    await page.mouse.move(mic.x - 150, mic.y + mic.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId('recording')).toHaveCount(0);

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

    // The calendar with something on it and the form open: the marks on the
    // grid, an event's answers, and the fields that make one.
    await page.evaluate(
      (day) =>
        fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Bowling', place: 'Le Strike', day, time: '19:00' }),
        }),
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    );
    await menu();
    await page.getByRole('button', { name: /^Calendar/ }).click();
    await expect(page.getByTestId('event').first()).toBeVisible();
    found.push(...(await faults(page, 'the calendar')));
    await page.getByTestId('ev-plan').click();
    found.push(...(await faults(page, 'planning something')));
    await close();

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

    // And what home holds: the night, from its card, and Settings from its
    // corner — with the invite inside it.
    await page.getByTestId('go-home').click();
    await page.getByTestId('dad-night').click();
    await settled();
    found.push(...(await faults(page, 'dad night')));
    await close();

    // Settings is a list of four, each a leaf of its own (2026-11-02). This
    // group was made by the script, so it has no creator: the room's leaf is
    // the three switches, everybody's.
    await page.getByTestId('home-settings').click();
    await settled();
    found.push(...(await faults(page, 'settings')));
    for (const [row, leaf] of [
      ['settings-you', 'settings-leaf-you'],
      ['settings-room', 'settings-leaf-room'],
      ['settings-device', 'settings-leaf-device'],
    ] as const) {
      await page.getByTestId(row).click();
      await expect(page.getByTestId(leaf)).toBeVisible();
      await settled();
      found.push(...(await faults(page, `settings, ${leaf}`)));
      await page.getByTestId('leaf-back').click();
    }
    await page.getByTestId('settings-invite').click();
    await expect(page.getByTestId('invite')).toBeVisible();
    await settled();
    found.push(...(await faults(page, 'the invite')));
    await close();

    // A line's own menu: marks, reply, edit, copy, take it back.
    await page.getByTestId('home-go').click();
    await page
      .getByTestId('line')
      .filter({ hasText: `a ${theme} line` })
      .click({ button: 'right' });
    await expect(page.getByTestId('line-menu')).toBeVisible();
    found.push(...(await faults(page, 'a line’s menu')));
    await page.keyboard.press('Escape');

    // On the call, with the camera on: the row of controls with the red
    // hang-up in it, his own picture, and the header's phone as the way out.
    await page.getByRole('button', { name: 'Join the call' }).click();
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await expect(page.getByTestId('call-tile')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('call-hangup')).toBeVisible();
    found.push(...(await faults(page, 'on a call')));
    // Another dad showing his picture, which carries "Keep in view" in its
    // corner (2026-11-02): a control on a moving picture.
    const other = await browser.newContext({ colorScheme: theme, reducedMotion: 'reduce' });
    const caller = await other.newPage();
    await caller.goto('/');
    await caller.getByLabel('The word').fill(E2E_A11Y_GROUP.code);
    await caller.getByLabel('Your name').fill(`${theme} caller`);
    await caller.getByRole('button', { name: 'Come in' }).click();
    await expect(caller.getByTestId('connection')).toHaveText(/here$/);
    await talk(caller);
    await caller.getByRole('button', { name: 'Join the call' }).click();
    await caller.getByRole('button', { name: 'Camera', exact: true }).click();
    await expect(page.getByTestId('call-pip')).toBeVisible({ timeout: 20_000 });
    found.push(...(await faults(page, 'on a call, with a picture that can float')));
    await other.close();
    await page.getByTestId('call-hangup').click();
    await expect(page.getByTestId('call')).toHaveCount(0);

    // A line reached from the keyboard, the ring on it; and a profile opened
    // from a name on a line, which is "who is here" opened on him.
    await page.locator('ol.lines').focus();
    await expect(page.locator('ol.lines li:focus')).toHaveCount(1);
    found.push(...(await faults(page, 'a line, from the keyboard')));
    await page
      .getByTestId('line')
      .filter({ hasText: `a ${theme} line` })
      .getByTestId('line-who')
      .click();
    await expect(page.getByTestId('profile')).toBeVisible();
    await settled();
    found.push(...(await faults(page, 'a profile, from a line')));
    await close();
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
    await page.getByTestId('home-settings').click();
    await settled();
    await page.getByTestId('settings-you').click();
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
