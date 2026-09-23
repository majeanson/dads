/**
 * Contrast audit over the design tokens, in both themes.
 *
 * The palette is small and plain, which is the easy kind to wreck with one
 * comfortable-looking tweak. This reads the real values out of the stylesheet
 * and checks the pairs the app actually renders — in light AND dark, because a
 * palette that only passes in the theme you happen to be using is half a
 * palette.
 *
 *   npm run audit:contrast
 *
 * WCAG 2.1: 4.5 for body text, 3.0 for the boundary of a control you are
 * meant to be able to find (1.4.11).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKENS = fileURLToPath(new URL('../src/web/styles/tokens.css', import.meta.url));

const PAIRS = [
  ['text', 'bg', 4.5, 'body text'],
  ['text', 'bg-soft', 4.5, 'body text on a panel'],
  ['muted', 'bg', 4.5, 'times, labels, asides'],
  ['muted', 'bg-soft', 4.5, 'asides on a panel'],
  ['accent', 'bg', 4.5, 'links and names'],
  ['accent', 'bg-soft', 4.5, 'links on a panel'],
  ['danger', 'bg', 4.5, 'an error'],
  ['danger', 'bg-soft', 4.5, 'an error on a panel'],
  ['on-accent', 'accent', 4.5, 'the label on a filled button'],
  // The one filled danger surface in the app: a "take it back" row once it is
  // armed. `bg` is the label on it, the way `on-accent` is on the accent.
  ['bg', 'danger', 4.5, 'the label on an armed destructive row'],
  // Home's answer control: "Can't" is filled in ink, not in the accent and
  // not in red, and the page colour is its label.
  ['bg', 'text', 4.5, 'the label on a chosen "can’t"'],
  ['dad-1', 'bg', 4.5, "dad 1's name"],
  ['dad-1', 'bg-soft', 4.5, "dad 1's name on a panel"],
  ['dad-2', 'bg', 4.5, "dad 2's name"],
  ['dad-2', 'bg-soft', 4.5, "dad 2's name on a panel"],
  ['dad-3', 'bg', 4.5, "dad 3's name"],
  ['dad-3', 'bg-soft', 4.5, "dad 3's name on a panel"],
  ['dad-4', 'bg', 4.5, "dad 4's name"],
  ['dad-4', 'bg-soft', 4.5, "dad 4's name on a panel"],
  ['dad-5', 'bg', 4.5, "dad 5's name"],
  ['dad-5', 'bg-soft', 4.5, "dad 5's name on a panel"],
  ['dad-6', 'bg', 4.5, "dad 6's name"],
  ['dad-6', 'bg-soft', 4.5, "dad 6's name on a panel"],
  ['border-strong', 'bg', 3.0, 'the border that makes a control findable'],
  ['border-strong', 'bg-soft', 3.0, 'that border on a panel'],
  ['accent', 'bg', 3.0, 'the focus ring'],
];

/** Reported but not gating: decorative, and load-bearing for nobody. */
const INFORMATIONAL = [
  ['border', 'bg', 'a divider between rows'],
  ['border', 'bg-soft', 'a divider inside a panel'],
];

/**
 * The light tokens live in the first bare `:root`; the dark ones in the
 * `:root` inside the prefers-color-scheme block. Dark inherits anything it
 * does not restate, which is exactly how the stylesheet is written.
 */
function parseThemes(css) {
  const light = block(css, /:root\s*\{([\s\S]*?)\}/);
  const darkMedia = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?\})\s*\}/.exec(css);
  if (darkMedia === null) throw new Error('no prefers-color-scheme: dark block in tokens.css');
  const dark = new Map([...light, ...block(darkMedia[1], /:root\s*\{([\s\S]*?)\}/)]);
  return { light, dark };
}

function block(css, re) {
  const found = re.exec(css);
  if (found === null) throw new Error(`no :root block found`);
  const tokens = new Map();
  for (const [, name, value] of found[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens.set(name, value);
  }
  return tokens;
}

function luminance(hex) {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(full.slice(i, i + 2), 16))
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function auditTheme(tokens) {
  return PAIRS.map(([fg, bg, required, what]) => {
    const a = tokens.get(fg);
    const b = tokens.get(bg);
    if (a === undefined || b === undefined) {
      return { fg, bg, what, required, ratio: 0, ok: false, missing: true };
    }
    const ratio = contrast(a, b);
    return { fg, bg, what, required, ratio, ok: ratio >= required, missing: false };
  });
}

const css = readFileSync(TOKENS, 'utf8');
const themes = parseThemes(css);
let failures = 0;

/**
 * The explicit override blocks must say exactly what the two above them say.
 *
 * They exist because a dad can ask for light or dark outright instead of
 * following his phone, and CSS gives no way to alias one palette to another —
 * so the duplication is real. This is what keeps it honest: drift in either
 * direction fails the audit rather than shipping a theme nobody checked.
 */
const COLOURS = [
  'bg',
  'bg-soft',
  'text',
  'muted',
  'border',
  'border-strong',
  'accent',
  'on-accent',
  'danger',
  'dad-1',
  'dad-2',
  'dad-3',
  'dad-4',
  'dad-5',
  'dad-6',
];

for (const name of ['light', 'dark']) {
  const explicit = block(css, new RegExp(`:root\\[data-theme='${name}'\\]\\s*\\{([\\s\\S]*?)\\}`));
  for (const token of COLOURS) {
    const expected = themes[name].get(token);
    const got = explicit.get(token);
    if (got !== expected) {
      console.error(
        `[data-theme='${name}'] --${token} is ${got ?? 'missing'}, ` +
          `but the ${name} palette says ${expected}`,
      );
      failures += 1;
    }
  }
}

for (const [name, tokens] of Object.entries(themes)) {
  const results = auditTheme(tokens);
  failures += results.filter((r) => !r.ok).length;

  if (!process.argv.includes('--quiet')) {
    console.log(`\n${name.toUpperCase()}`);
    for (const r of results) {
      const mark = r.ok ? 'ok  ' : 'FAIL';
      const ratio = r.missing
        ? 'missing token'
        : `${r.ratio.toFixed(2)} / ${r.required.toFixed(1)}`;
      console.log(`  ${mark} ${`${r.fg} on ${r.bg}`.padEnd(30)} ${ratio.padEnd(16)} ${r.what}`);
    }
    for (const [fg, bg, what] of INFORMATIONAL) {
      const a = tokens.get(fg);
      const b = tokens.get(bg);
      const ratio = a && b ? contrast(a, b).toFixed(2) : 'missing token';
      console.log(`  --   ${`${fg} on ${bg}`.padEnd(30)} ${String(ratio).padEnd(16)} ${what}`);
    }
  }
}

const total = PAIRS.length * 2;
if (!process.argv.includes('--quiet')) {
  console.log(`\n${total - failures}/${total} required pairs pass across both themes`);
}
if (failures > 0) process.exit(1);
