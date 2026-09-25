/**
 * The PNGs, from the one SVG.
 *
 *   npm run icons
 *
 * Rendered with the Playwright chromium that is already in the repo rather
 * than a new image dependency: the artwork lives in public/icon.svg and
 * nothing else is drawn by hand, so the tab, the home screen and the manifest
 * can never drift apart.
 *
 * Committed to the repo, not built on deploy — a deploy should not need a
 * browser.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(`${PUBLIC}icon.svg`, 'utf8');

/** favicon.ico is a PNG under the name every browser guesses at. */
const SIZES = [
  ['favicon.ico', 32],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const [name, size] of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const shot = await page.locator('svg').screenshot({ omitBackground: true });
  writeFileSync(`${PUBLIC}${name}`, shot);
  console.log(`${name.padEnd(22)} ${size}×${size}`);
}

// The link preview (1200x630, what a chat app unfurls): the same face,
// big, beside the wordmark in the app's one display face. Drawn from
// icon.svg's own shapes so the preview is the icon, not a picture of it.
const font = readFileSync(`${PUBLIC}fonts/bricolage-700-latin.woff2`).toString('base64');
const face = svg.replace(/<rect width="512" height="512"[^>]*\/>/, '');
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>
  @font-face { font-family: B; src: url(data:font/woff2;base64,${font}) format('woff2'); }
  html, body { margin: 0; }
  .og { width: 1200px; height: 630px; box-sizing: border-box; display: flex; align-items: center;
        gap: 56px; padding: 0 96px; background: #28486b; color: #fcfcfb; font-family: B, sans-serif; }
  .og svg { width: 380px; height: 380px; flex: none; }
  .og h1 { margin: 0; font-size: 168px; line-height: 1; letter-spacing: -0.03em; }
  .og p { margin: 20px 0 0; font-size: 44px; line-height: 1.2; opacity: 0.85; }
</style><div class="og">${face}<div><h1>dads</h1><p>Somewhere to talk,<br>and a table to sit at.</p></div></div>`);
// A string, not a function: this runs in the page, and the linter reads the
// file as Node, where there is no document.
await page.evaluate('document.fonts.ready');
writeFileSync(`${PUBLIC}og.png`, await page.locator('.og').screenshot());
console.log(`${'og.png'.padEnd(22)} 1200×630`);

await browser.close();
