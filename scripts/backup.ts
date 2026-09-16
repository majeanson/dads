import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './run';

/**
 * Everything in D1, in one file, on this machine.
 *
 * D1's Time Travel gives thirty days of point-in-time recovery, and it is
 * good: it covers the mistake you notice this month. It does not cover the
 * mistake you notice in June, an account that goes away, or a schema change
 * that eats a column on the way past. This is five friends' conversation, the
 * questions they have answered and what they said they would try — the sort of
 * thing whose value is exactly that it goes back years.
 *
 * `npm run backup` writes backups/dads-YYYY-MM-DD.json. Plain JSON, one array
 * per table, no tool needed to read it: a backup you cannot open with the
 * thing you already have is a backup you find out about too late.
 *
 * What is NOT in here is R2 — the photographs. Their records are (so you know
 * what is missing), but the blobs are megabytes each and belong in
 * `wrangler r2 object get`, not in a JSON file. The cap is ten to a room.
 */
const TABLES = [
  'groups',
  'members',
  'messages',
  'media',
  'prompts',
  'prompt_days',
  'check_ins',
  'commitments',
  'presence',
  'rsvps',
  'night_items',
  'reactions',
  'invites',
  'push_subscriptions',
];

interface D1Result {
  results: Record<string, unknown>[];
}

/**
 * Three goes at each table. The first backup of 2026-09-16 failed outright
 * on a transient "account is not authorized [code: 7403]" from Cloudflare
 * and the second run succeeded; a cron that hits that once backs up nothing
 * that day and tells nobody.
 */
function query(sql: string, remote: boolean): Record<string, unknown>[] {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return queryOnce(sql, remote);
    } catch (err) {
      last = err;
      console.error(`${sql}: attempt ${attempt + 1} failed, trying again`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
  throw last;
}

function queryOnce(sql: string, remote: boolean): Record<string, unknown>[] {
  const out = run('npx', [
    'wrangler',
    'd1',
    'execute',
    'dads',
    remote ? '--remote' : '--local',
    '--json',
    '--command',
    sql,
  ]);
  // wrangler prints the JSON array of statement results, sometimes after a
  // banner. Take from the first bracket.
  const json = out.slice(out.indexOf('['));
  const parsed = JSON.parse(json) as D1Result[];
  return parsed[0]?.results ?? [];
}

const remote = !process.argv.includes('--local');
const day = new Date().toISOString().slice(0, 10);
const dir = join(process.cwd(), 'backups');
mkdirSync(dir, { recursive: true });

const dump: Record<string, unknown> = {
  takenAt: new Date().toISOString(),
  source: remote ? 'remote' : 'local',
};

for (const table of TABLES) {
  const rows = query(`SELECT * FROM ${table}`, remote);
  dump[table] = rows;
  console.log(`${table}: ${rows.length}`);
}

// The invite tokens and the device-token hashes are in here. It is a copy of
// the database and should be treated as one; backups/ is gitignored for that
// reason and not because it is large.
const path = join(dir, `dads-${day}.json`);
writeFileSync(path, `${JSON.stringify(dump, null, 2)}\n`);
console.log(`\n→ ${path}`);
