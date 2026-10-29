import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { query } from './d1';
import { run } from './run';

/**
 * The photographs that cannot be taken again, on this machine.
 *
 * `npm run backup` is D1 only. Most pictures are on a shelf that prunes itself
 * (forty to a room), so losing one is nothing, but two kinds are not like
 * that: a dad's FACE (one object each, 320px) and a picture somebody KEPT
 * (up to a hundred a room, exempt from the pruner on purpose). Those are what
 * this copies, and only those.
 *
 * wrangler cannot list a bucket, so the keys come from D1, which knows every
 * one of them: `members.avatar_key` and `media` where `kept`. A face is one
 * key overwritten whenever he changes it, so faces are fetched every time;
 * a media key never changes, so a kept picture already on disk is left alone.
 *
 *   npm run backup:r2 [-- --local]
 *
 * Into backups/r2/<key>, plus a manifest beside it. Like the D1 backup it is
 * a copy of private data, and backups/ is gitignored for that.
 */
const BUCKET = 'dads-media';
const remote = !process.argv.includes('--local');
const root = join(process.cwd(), 'backups', 'r2');
mkdirSync(root, { recursive: true });

const faces = query(
  "SELECT avatar_key AS key FROM members WHERE avatar_key IS NOT NULL AND avatar_key <> ''",
  remote,
).map((r) => String(r.key));
const kept = query('SELECT r2_key AS key FROM media WHERE kept = 1', remote).map((r) =>
  String(r.key),
);
console.log(`${faces.length} faces, ${kept.length} kept pictures`);

/** Wrangler creates the file before it knows the key exists: a key that is not
 * there (a picture pruned since D1 was read) leaves an EMPTY file and exit 1.
 * That file must never pass for a backup, now or on the next run. */
const onDisk = (file: string) => existsSync(file) && statSync(file).size > 0;

function fetchOne(key: string): boolean {
  // A key is `faces/<group>/<member>` or `<group>/<id>`: ids, never a path a
  // dad chose. Refuse anything else rather than write outside backups/.
  if (!/^[\w-]+(\/[\w.-]+)+$/.test(key) || key.includes('..')) {
    console.error(`${key}: not a key this script writes — skipped`);
    return false;
  }
  const file = join(root, ...key.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      run('npx', [
        'wrangler',
        'r2',
        'object',
        'get',
        `${BUCKET}/${key}`,
        '--file',
        file,
        remote ? '--remote' : '--local',
      ]);
      if (onDisk(file)) return true;
    } catch {
      console.error(`${key}: attempt ${attempt + 1} failed`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
  rmSync(file, { force: true });
  return false;
}

const copied: { key: string; bytes: number }[] = [];
const failed: string[] = [];
for (const key of [...faces, ...kept]) {
  const file = join(root, ...key.split('/'));
  const isFace = key.startsWith('faces/');
  if (!isFace && onDisk(file)) {
    copied.push({ key, bytes: statSync(file).size });
    continue;
  }
  if (fetchOne(key) && onDisk(file)) copied.push({ key, bytes: statSync(file).size });
  else failed.push(key);
}

const day = new Date().toISOString().slice(0, 10);
const manifest = join(root, `manifest-${day}.json`);
writeFileSync(
  manifest,
  `${JSON.stringify({ takenAt: new Date().toISOString(), source: remote ? 'remote' : 'local', copied, failed }, null, 2)}\n`,
);
console.log(`${copied.length} on disk, ${failed.length} failed → ${manifest}`);
if (failed.length > 0) process.exitCode = 1;
