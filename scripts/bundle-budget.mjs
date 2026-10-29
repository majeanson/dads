import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Holds the built client to a size budget, gzipped, so a heavy import is a
 * red build and not something found on a phone in a tunnel.
 *
 *   npm run build && npm run audit:bundle            check against the budget
 *   npm run audit:bundle -- --update                 re-baseline (+10%)
 *
 * Three numbers, from dist/: the entry script index.html loads (everything a
 * cold open pays for), the stylesheet, and every asset together (the sheets
 * load lazily, so the total is the ceiling on what one dad could ever fetch).
 * The budget is bundle-budget.json beside this file; raising it is a visible
 * line in a diff with a reason in the commit.
 */
const dist = join(process.cwd(), 'dist');
const budgetFile = join(process.cwd(), 'scripts', 'bundle-budget.json');
const gz = (file) => gzipSync(readFileSync(file)).length;

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = html.match(/\/assets\/(index-[^"]+\.js)/)?.[1];
if (!entry) throw new Error('dist/index.html names no entry script — build first');

const assets = readdirSync(join(dist, 'assets'));
const css = assets.filter((f) => f.endsWith('.css'));
const measured = {
  entryJs: gz(join(dist, 'assets', entry)),
  css: css.reduce((n, f) => n + gz(join(dist, 'assets', f)), 0),
  total: assets
    .filter((f) => /\.(js|css)$/.test(f))
    .reduce((n, f) => n + gz(join(dist, 'assets', f)), 0),
};

if (process.argv.includes('--update')) {
  const next = Object.fromEntries(
    Object.entries(measured).map(([k, v]) => [k, Math.ceil((v * 1.1) / 1024) * 1024]),
  );
  writeFileSync(budgetFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log('budget written', next);
  process.exit(0);
}

const budget = JSON.parse(readFileSync(budgetFile, 'utf8'));
let over = false;
for (const [name, bytes] of Object.entries(measured)) {
  const max = budget[name];
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  const bad = bytes > max;
  over ||= bad;
  console.log(`${bad ? 'OVER' : 'ok  '}  ${name.padEnd(8)} ${kb(bytes)} of ${kb(max)}`);
}
if (over) {
  console.error('\nThe build is over its size budget. Find what grew; or, if it is worth it,');
  console.error('re-baseline with `npm run audit:bundle -- --update` and say why.');
  process.exit(1);
}
