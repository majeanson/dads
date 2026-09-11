import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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
    const context = await browser.newContext({ colorScheme: theme });
    const page = await context.newPage();
    const found: string[] = [];

    await page.goto('/');
    found.push(...(await faults(page, 'the door')));

    await page.getByLabel('Code').fill(E2E_A11Y_GROUP.code);
    await page.getByLabel('Your name').fill(theme === 'light' ? 'Marc' : 'Sam');
    await page.getByRole('button', { name: 'Come in' }).click();
    await expect(page.getByTestId('connection')).toHaveText(/here$/);

    // One of everything in the conversation so the rows are checked too.
    await page.getByLabel('Say something').fill('a line with a link https://example.com in it');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('line').filter({ hasText: 'a line with' })).toBeVisible();
    found.push(...(await faults(page, 'the room')));

    const menu = () => page.getByRole('button', { name: 'Menu' }).click();
    const close = () => page.getByRole('button', { name: 'Close', exact: true }).first().click();

    await menu();
    found.push(...(await faults(page, 'the menu')));
    await close();

    await page.getByTestId('connection').click();
    found.push(...(await faults(page, 'who is here')));
    await close();

    const items: [string, RegExp][] = [
      ['dad night', /^Set dad night/],
      ['the week', /^The week/],
      ['the questions', /^Questions/],
      ['settings', /^Settings/],
      ['the invite', /^Invite a dad/],
    ];
    for (const [scene, name] of items) {
      await menu();
      await page.getByRole('button', { name }).click();
      await page.waitForTimeout(400);
      found.push(...(await faults(page, scene)));
      await close();
    }

    expect(found).toEqual([]);
    await context.close();
  });
}
