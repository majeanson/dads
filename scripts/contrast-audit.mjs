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

/*
 * `color-mix(in oklab, A p%, B)`, the way a browser does it: into OKLab
 * (Björn Ottosson's matrices), a straight blend there, and back to sRGB,
 * clipped. A face with no photograph is filled this way, and the ink on it is
 * a rendered pair like any other — it just is not a token.
 */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklab(hex) {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(full.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToHex([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function mixOklab(a, b, pa) {
  const [x, y] = [hexToOklab(a), hexToOklab(b)];
  return oklabToHex(x.map((v, i) => v * pa + y[i] * (1 - pa)));
}

/** The share of his colour in a face with no photograph, from `.face-blank`. */
function faceMix(css) {
  const found =
    /\.face-blank\s*\{[^}]*color-mix\(in oklab,\s*var\(--dad\)\s*(\d+(?:\.\d+)?)%,\s*var\(--bg\)\)/.exec(
      css,
    );
  if (found === null)
    throw new Error('no .face-blank color-mix(in oklab, var(--dad) N%, var(--bg)) rule');
  return Number(found[1]) / 100;
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

/*
 * The ink on a face with no photograph: his glasses and his smile, drawn in
 * `--text` on his colour mixed into `--bg`. Graphics, not words, so 3.0
 * (1.4.11) — but all six colours, in both palettes, because a mix that reads
 * in light can go to mud in dark, where the colours are the pale ones.
 */
const mix = faceMix(css);
const FACES = [1, 2, 3, 4, 5, 6].map((n) => `dad-${n}`);
for (const [name, tokens] of Object.entries(themes)) {
  if (!process.argv.includes('--quiet')) {
    console.log(`\n${name.toUpperCase()} — faces with no photo (${Math.round(mix * 100)}% mix)`);
  }
  for (const dad of FACES) {
    const colour = tokens.get(dad);
    const ink = tokens.get('text');
    const ground = tokens.get('bg');
    if (!colour || !ink || !ground) {
      console.error(`  FAIL ${dad}: missing token`);
      failures += 1;
      continue;
    }
    const fill = mixOklab(colour, ground, mix);
    const ratio = contrast(ink, fill);
    const ok = ratio >= 3;
    if (!ok) failures += 1;
    if (!process.argv.includes('--quiet') || !ok) {
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${`text on ${dad} face (${fill})`.padEnd(30)} ${`${ratio.toFixed(2)} / 3.0`.padEnd(16)} glasses and smile`,
      );
    }
  }
}

const total = PAIRS.length * 2 + FACES.length * 2;
if (!process.argv.includes('--quiet')) {
  console.log(`\n${total - failures}/${total} required pairs pass across both themes`);
}
if (failures > 0) process.exit(1);
