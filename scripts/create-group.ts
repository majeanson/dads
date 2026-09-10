/**
 * Creates a group and prints its invite code.
 *
 * Group creation is deliberately not a public flow in v1: the product is "the
 * dads", a group whose members already know each other, and a create-a-group
 * button would invite exactly the strangers the invite code exists to keep out.
 * The data model is multi-group; the door is this script.
 *
 *   npm run group:create -- --slug the-dads --name "The Dads" --night thu:21:00
 *   npm run group:create -- --slug the-dads --name "The Dads" --remote
 *
 * Prints the plaintext code once. It is not recoverable afterwards — only its
 * PBKDF2 hash is stored — so rotating means running this again with --code.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashInviteCode, randomToken } from '../src/worker/crypto';
import { run } from './run';
import { WORDS } from './words';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * A code you can say down a phone line.
 *
 * WORDS is exactly 256 long, and 256 divides 2^32 evenly, so the modulo is
 * unbiased and every word carries a clean 8 bits.
 *
 * Two words is 16 bits — 65,536 codes. Against the join throttle (10 wrong
 * guesses per IP per 10 minutes, each costing the server a 120k-iteration
 * PBKDF2) that is ~45 days of continuous guessing from one address to cover
 * the space, and the door is not published anywhere. Four words is 32 bits and
 * out of reach entirely. Rotate to more words by running this again with
 * --words 4.
 */
function generateCode(count: number): string {
  const picks = crypto.getRandomValues(new Uint32Array(count));
  return [...picks].map((n) => WORDS[n % WORDS.length]).join(' ');
}

const slug = arg('slug');
const name = arg('name');
if (!slug || !name) {
  console.error(
    'usage: --slug <slug> --name "<name>" [--code "<code>"] [--words 4] [--night thu:21:00] [--tz <IANA>] [--remote]',
  );
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`slug must be lowercase letters, digits and dashes: got "${slug}"`);
  process.exit(1);
}

const wordCount = Number(arg('words') ?? 4);
if (!Number.isInteger(wordCount) || wordCount < 1 || wordCount > 8) {
  console.error('--words must be a whole number between 1 and 8');
  process.exit(1);
}
const code = arg('code') ?? generateCode(wordCount);
const tz = arg('tz') ?? 'America/Montreal';
const remote = process.argv.includes('--remote');

let weekday: number | null = null;
let time: string | null = null;
const night = arg('night');
if (night) {
  const [day, ...rest] = night.split(':');
  const index = WEEKDAYS.indexOf((day ?? '').toLowerCase());
  const clock = rest.join(':');
  if (index === -1 || !/^\d{2}:\d{2}$/.test(clock)) {
    console.error('--night must look like thu:21:00');
    process.exit(1);
  }
  weekday = index;
  time = clock;
}

const salt = randomToken(16);
const hash = await hashInviteCode(code, salt);
const id = `grp_${randomToken(12)}`;
const now = Date.now();

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
const sql = `INSERT INTO groups
  (id, slug, name, invite_code_hash, invite_code_salt,
   dad_night_weekday, dad_night_time, dad_night_tz, jaffre_room_code, created_at)
VALUES (${quote(id)}, ${quote(slug)}, ${quote(name)}, ${quote(hash)}, ${quote(salt)},
  ${weekday ?? 'NULL'}, ${time ? quote(time) : 'NULL'}, ${quote(tz)}, NULL, ${now});`;

const file = join(mkdtempSync(join(tmpdir(), 'dads-')), 'create-group.sql');
writeFileSync(file, sql);

run(
  'npx',
  ['wrangler', 'd1', 'execute', 'dads', remote ? '--remote' : '--local', '--file', file, '-y'],
  'inherit',
);

console.log(`\nGroup "${name}" created ${remote ? 'in production' : 'locally'}.`);
console.log(`  slug        ${slug}`);
console.log(`  invite code ${code}`);
console.log('\nThis code is shown once. Only its hash is stored.');
