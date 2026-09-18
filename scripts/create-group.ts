/**
 * Creates a group and prints its invite code.
 *
 * This is no longer the only way a room exists — anybody at the door can open
 * one — but it is still how the first group was made and it is still how a
 * word is rotated from a laptop rather than from inside the app.
 *
 *   npm run group:create -- --slug the-dads --name "The Dads" --night thu:21:00
 *   npm run group:create -- --slug the-dads --name "The Dads" --remote
 *   npm run group:create -- --slug the-dads --rotate --code "<new code>" --remote
 *
 * Prints the plaintext code once. It is not recoverable afterwards — only its
 * PBKDF2 hash is stored — so changing it means --rotate.
 *
 * --rotate UPDATEs the hash and salt in place and touches nothing else. The
 * members, the archive, the questions and the board are the group's history;
 * they must not be collateral damage from changing a passphrase, which is
 * what re-creating the group would make them.
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
const rotate = process.argv.includes('--rotate');
const name = arg('name') ?? (rotate ? '' : undefined);
if (!slug || name === undefined) {
  console.error(
    'usage: --slug <slug> --name "<name>" [--code "<code>"] [--words 4] [--night thu:21:00] [--tz <IANA>] [--remote]\n' +
      '       --slug <slug> --rotate [--code "<code>"] [--words 4] [--remote]',
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
const sql = rotate
  ? // Two things go with the hash, and leaving either behind makes the
    // rotation a lie.
    //
    // The fingerprint is keyed with the Worker's secret, which this laptop
    // does not have, so it cannot be recomputed here — it is set back to NULL
    // and the room learns the new word on the first join, exactly as a room
    // this script has just made does. Left pointing at the OLD word, the
    // indexed lookup would miss and the NULL-only scan would skip the room:
    // a door nobody can open, including the dads.
    //
    // And an invite carries its own secret, so it goes on working whatever
    // the word is. A man changing the word is closing a door; keys left on
    // the step are the same door, open.
    `UPDATE groups
        SET invite_code_hash = ${quote(hash)}, invite_code_salt = ${quote(salt)},
            invite_code_lookup = NULL
      WHERE slug = ${quote(slug)};
DELETE FROM invites WHERE group_id = (SELECT id FROM groups WHERE slug = ${quote(slug)});`
  : `INSERT INTO groups
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

console.log(
  rotate
    ? `\nCode rotated for "${slug}" ${remote ? 'in production' : 'locally'}.`
    : `\nGroup "${name}" created ${remote ? 'in production' : 'locally'}.`,
);
console.log(`  slug        ${slug}`);
console.log(`  invite code ${code}`);
console.log('\nThis code is shown once. Only its hash is stored.');
