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

await browser.close();
