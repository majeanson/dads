import { expect, test, type Page } from '@playwright/test';
import { CODE, named } from './names';

/**
 * Every main scene, at every width, measured rather than looked at.
 *
 * A screenshot of a real iPhone is what started this: the room was half off
 * the right-hand side and nothing in the suite had noticed, because nothing
 * in the suite asked. This asks, for each scene a dad actually stands in —
 * the door, the room, every sheet, the table — at four widths and in the
 * language with the longest words.
 *
 * Only objective faults are checked here. Nothing is a matter of taste:
 *   - the page scrolls sideways
 *   - a control is off the edge of the screen
 *   - a control is too short to press with a thumb
 *   - visible text has been cut off rather than wrapped
 *   - something is wider than the box it is in
 */
test.describe.configure({ mode: 'serial' });

const WIDTHS = [
  { name: 'a small phone', width: 360, height: 740 },
  { name: 'a large phone', width: 430, height: 932 },
  { name: 'a tablet', width: 834, height: 1112 },
  { name: 'a desktop', width: 1440, height: 900 },
];

/** Runs in the page. Returns the faults, in words, or none. */
function probe(): string[] {
  const doc = document.documentElement;
  const W = doc.clientWidth;
  const faults: string[] = [];
  const box = (el: Element) => el.getBoundingClientRect();

  // A 1px box with its overflow clipped is a screen-reader-only span, not a
  // thing on the screen.
  const visible = (el: Element) => {
    const r = box(el);
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  if (doc.scrollWidth > W + 0.5) faults.push(`page scrolls sideways (${doc.scrollWidth} > ${W})`);

  for (const el of document.querySelectorAll(
    'button, a[href], input, select, textarea, [role=button]',
  )) {
    if (!visible(el)) continue;
    const r = box(el);
    const name = (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName)
      .trim()
      .slice(0, 28);
    if (r.right > W + 0.5) faults.push(`off the right edge: ${name}`);
    if (r.left < -0.5) faults.push(`off the left edge: ${name}`);
    // A switch inside its own full-width label is pressed through the label.
    if (r.height < 28 && !el.closest('label')) {
      faults.push(`too small to press: ${name} (${Math.round(r.height)}px)`);
    }
  }

  for (const el of document.querySelectorAll('p, span, h1, h2, li, label')) {
    if (!visible(el) || el.children.length > 0) continue;
    const cs = getComputedStyle(el);
    if (
      cs.overflow === 'hidden' &&
      el.scrollWidth > el.clientWidth + 1 &&
      cs.textOverflow !== 'ellipsis'
    ) {
      faults.push(`clipped text: ${(el.textContent || '').trim().slice(0, 30)}`);
    }
  }

  for (const el of document.querySelectorAll('*')) {
    if (el === document.body || el === doc || !visible(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') {
      faults.push(`wider than its box: ${el.tagName}.${String(el.className).slice(0, 24)}`);
    }
  }
  return faults;
}

async function faultsIn(page: Page, scene: string): Promise<string[]> {
  await page.waitForTimeout(400);
  const faults = await page.evaluate(probe);
  return faults.map((f) => `${scene}: ${f}`);
}

async function close(page: Page) {
  await page.getByRole('button', { name: 'Ferme', exact: true }).first().click();
  await page.waitForTimeout(250);
}

for (const size of WIDTHS) {
  test(`every scene fits ${size.name}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
    });
    const page = await context.newPage();
    const faults: string[] = [];

    // The door, in the longer language.
    await page.goto('/');
    await page.getByRole('button', { name: 'FR', exact: true }).click();
    faults.push(...(await faultsIn(page, 'the door')));

    await page.getByLabel('Code').fill(CODE);
    await page.getByLabel('Ton nom').fill(named('screens'));
    await page.getByRole('button', { name: 'Entre' }).click();
    await expect(page.getByTestId('connection')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    faults.push(...(await faultsIn(page, 'the room')));

    const rooms = await page.evaluate(async () => {
      const r = await fetch('/api/me');
      return ((await r.json()) as { group: { rooms: Record<string, boolean> } }).group.rooms;
    });

    const menu = () => page.getByRole('button', { name: 'Menu' }).click();
    const sheets: [string, () => Promise<void>][] = [
      ['the menu', menu],
      ['who is here', () => page.getByTestId('connection').click()],
      [
        'dad night',
        async () => {
          await menu();
          await page.getByTestId('dad-night').click();
        },
      ],
      [
        'the invite',
        async () => {
          await menu();
          await page.getByRole('button', { name: /Invite un chum/ }).click();
        },
      ],
      [
        'settings',
        async () => {
          await menu();
          await page.getByRole('button', { name: 'Réglages' }).click();
        },
      ],
    ];
    if (rooms.week) {
      sheets.push([
        'the week',
        async () => {
          await menu();
          await page.getByRole('button', { name: /^La semaine/ }).click();
          await page.getByTestId('board').waitFor();
        },
      ]);
    }
    if (rooms.questions) {
      sheets.push([
        'the questions',
        async () => {
          await menu();
          await page.getByRole('button', { name: /^Les questions/ }).click();
          await page.getByTestId('prompt-body').waitFor();
        },
      ]);
    }

    for (const [scene, open] of sheets) {
      await open();
      faults.push(...(await faultsIn(page, scene)));
      await close(page);
    }

    if (rooms.table) {
      await menu();
      await page.getByRole('button', { name: /Ouvre la table/ }).click();
      await page.waitForTimeout(2000);
      faults.push(...(await faultsIn(page, 'the table')));
    }

    expect(faults).toEqual([]);
    await context.close();
  });
}
