import { expect, test, type Page } from '@playwright/test';
import { CODE, named } from './names';

/**
 * The room on a phone, in both languages.
 *
 * This exists because of a screenshot. A real iPhone, 430 points wide, reading
 * in French: "Embarque dans l'appel" did not fit beside the group's name, so
 * the header did not wrap — it made the whole PAGE wider, and everything, the
 * composer included, was half off the right-hand side. The breakpoint that was
 * meant to catch it was 26rem, which is a 416px phone. The phone was 430.
 *
 * So this does not test a breakpoint. It asserts the only thing that actually
 * matters — that the room never scrolls sideways — at the widths phones come
 * in, in the language with the longest words.
 */
test.describe.configure({ mode: 'serial' });

const PHONES = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPhone Pro Max', width: 430, height: 932 },
  { name: 'a small Android', width: 360, height: 740 },
];

async function measure(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const head = document.querySelector('.room-head')!.getBoundingClientRect();
    const composer = document.querySelector('.composer')!.getBoundingClientRect();
    return {
      sideways: doc.scrollWidth > doc.clientWidth,
      headFits: head.right <= doc.clientWidth + 0.5,
      composerFits: composer.right <= doc.clientWidth + 0.5,
      // A control that has slid off the side is still a control nobody can
      // press, even when the page itself does not scroll.
      offscreen: [...document.querySelectorAll('.room-head button, .composer button')].filter(
        (el) => el.getBoundingClientRect().right > doc.clientWidth + 0.5,
      ).length,
    };
  });
}

for (const phone of PHONES) {
  for (const lang of ['EN', 'FR'] as const) {
    test(`the room fits a ${phone.name} in ${lang}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: phone.width, height: phone.height },
      });
      const page = await context.newPage();
      await page.goto('/');
      await page.getByRole('button', { name: lang, exact: true }).click();

      await page.getByLabel(lang === 'FR' ? 'Code' : 'Code').fill(CODE);
      await page.getByLabel(lang === 'FR' ? 'Ton nom' : 'Your name').fill(named('fit'));
      await page.getByRole('button', { name: lang === 'FR' ? 'Entre' : 'Come in' }).click();
      await expect(page.getByTestId('connection')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1200);

      expect(await measure(page)).toEqual({
        sideways: false,
        headFits: true,
        composerFits: true,
        offscreen: 0,
      });

      // The sheets are full-screen on a phone and are the other half of the
      // layout; a menu that overflows is a menu with an item nobody can reach.
      await page.getByRole('button', { name: lang === 'FR' ? 'Menu' : 'Menu' }).click();
      await page.waitForTimeout(500);
      const withMenu = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(withMenu).toBe(false);

      await context.close();
    });
  }
}
