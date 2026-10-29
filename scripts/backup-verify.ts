import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Proves a backup can be put back.
 *
 * Builds an empty SQLite from migrations/ (the schema production has), loads
 * the newest backups/*.json (or the file named) into it and compares row
 * counts table by table. A backup nobody has restored is a hope; this is the
 * restoring, on a throwaway in-memory database. Nothing is written anywhere.
 *
 * Columns the backup has and today's schema has not are reported, not fatal: a
 * later migration dropped them. Columns the schema has and the backup has not
 * take their defaults. A table the backup names that the schema lacks is a
 * failure (a rename without a migration of the data).
 *
 *   npm run backup:verify [-- backups/dads-2026-10-23.json]
 */
const root = process.cwd();
const dir = join(root, 'backups');
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const file =
  arg ??
  join(
    dir,
    readdirSync(dir)
      .filter((f) => /^dads-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .at(-1) ?? '',
  );

const dump = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
const meta = new Set(['takenAt', 'source', 'missingTables']);

const db = new DatabaseSync(':memory:');
for (const name of readdirSync(join(root, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  db.exec(readFileSync(join(root, 'migrations', name), 'utf8'));
}
// Rows reference each other in whatever order the dump has them.
db.exec('PRAGMA foreign_keys = OFF');

let failed = false;
const fail = (line: string) => {
  failed = true;
  console.error(`FAIL  ${line}`);
};

console.log(`restoring ${file}\n`);
for (const [table, value] of Object.entries(dump)) {
  if (meta.has(table)) continue;
  const rows = value as Record<string, unknown>[];
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (info.length === 0) {
    fail(`${table}: in the backup, not in the schema`);
    continue;
  }
  const known = new Set(info.map((c) => c.name));
  const dropped = new Set<string>();
  // The migrations seed the prompt library; the backup carries its own copy.
  db.exec(`DELETE FROM ${table}`);
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => (known.has(c) ? true : (dropped.add(c), false)));
    const stmt = db.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    );
    stmt.run(...cols.map((c) => row[c] as null | number | string));
  }
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  const note =
    dropped.size > 0 ? `  (columns no longer in the schema: ${[...dropped].join(', ')})` : '';
  if (n !== rows.length) fail(`${table}: ${rows.length} in the backup, ${n} restored`);
  else console.log(`ok    ${table}: ${n}${note}`);
}

const orphans = db.prepare('PRAGMA foreign_key_check').all();
if (orphans.length > 0) fail(`${orphans.length} rows point at a row that is not there`);

if (Array.isArray(dump.missingTables) && dump.missingTables.length > 0) {
  console.log(
    `\nnote  the backup says it never saw: ${(dump.missingTables as string[]).join(', ')}`,
  );
}
if (failed) process.exit(1);
console.log('\nrestorable.');
