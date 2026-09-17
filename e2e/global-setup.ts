import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../scripts/run';

/**
 * One group per spec file, created fresh on every run.
 *
 * They cannot share: a room's roster is global to its group, so a dad joining
 * for the join spec would appear in the room spec's "2 here" and vice versa.
 * Files run in parallel; tests within a file that share a group run serially.
 */
export const E2E_GROUP = { slug: 'e2e-dads', name: 'The E2E Dads', code: 'maple otter cedar fern' };
export const E2E_ROOM_GROUP = {
  slug: 'e2e-room',
  name: 'The E2E Room',
  code: 'birch comet quill sage',
};
export const E2E_NIGHT_GROUP = {
  slug: 'e2e-night',
  name: 'The E2E Night',
  code: 'cedar thistle pewter rowan',
};
export const E2E_PROMPT_GROUP = {
  slug: 'e2e-prompt',
  name: 'The E2E Prompts',
  code: 'walnut sienna kettle bison',
};
export const E2E_BOARD_GROUP = {
  slug: 'e2e-board',
  name: 'The E2E Board',
  code: 'harbor lilac gravel teak',
};
export const E2E_TABLE_GROUP = {
  slug: 'e2e-table',
  name: 'The E2E Table',
  code: 'pigeon marble sorrel dune',
};
export const E2E_CALL_GROUP = {
  slug: 'e2e-call',
  name: 'The E2E Call',
  code: 'lantern spruce heron opal',
};
export const E2E_PREFS_GROUP = {
  slug: 'e2e-prefs',
  name: 'The E2E Prefs',
  code: 'meadow tinder copper wren',
};
export const E2E_LEAVE_GROUP = {
  slug: 'e2e-leave',
  name: 'The E2E Leaving',
  code: 'anchor pewter fable mint',
};
export const E2E_INVITE_GROUP = {
  slug: 'e2e-invite',
  name: 'The E2E Invite',
  code: 'clover ferry basalt wren',
};
export const E2E_FRESH_GROUP = {
  slug: 'e2e-fresh',
  name: 'The E2E Fresh',
  code: 'ember quartz willow lark',
};
export const E2E_A11Y_GROUP = {
  slug: 'e2e-a11y',
  name: 'The E2E Access',
  code: 'moss falcon tundra reed',
};
export const E2E_HOME_GROUP = {
  slug: 'e2e-home',
  name: 'The E2E Home',
  code: 'gravel cinder poplar vane',
};
export const E2E_FIND_GROUP = {
  slug: 'e2e-find',
  name: 'The E2E Find',
  code: 'harbour lantern spruce dune',
};
export const E2E_FIT_GROUP = {
  slug: 'e2e-fit',
  name: 'The E2E Fit',
  code: 'saffron pebble linden moth',
};
export const E2E_POLL_GROUP = {
  slug: 'e2e-poll',
  name: 'The E2E Poll',
  code: 'juniper anvil kestrel loam',
};
const GROUPS = [
  E2E_CALL_GROUP,
  E2E_GROUP,
  E2E_ROOM_GROUP,
  E2E_NIGHT_GROUP,
  E2E_PROMPT_GROUP,
  E2E_BOARD_GROUP,
  E2E_TABLE_GROUP,
  E2E_PREFS_GROUP,
  E2E_LEAVE_GROUP,
  E2E_INVITE_GROUP,
  E2E_FRESH_GROUP,
  E2E_A11Y_GROUP,
  E2E_HOME_GROUP,
  E2E_FIND_GROUP,
  E2E_FIT_GROUP,
  E2E_POLL_GROUP,
];

/**
 * wrangler, with a second and third go at it.
 *
 * `d1 execute --local` has come back "SQLITE_BUSY: database is locked" on CI
 * immediately after the migration step — the previous workerd had not let go
 * of the file yet. Everything this runs is idempotent (drop by slug, then
 * create), so trying again is the honest fix; turning CI red for a lock nobody
 * can act on is not.
 */
function wrangler(...args: string[]): string {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return run('npx', ['wrangler', ...args]);
    } catch (err) {
      last = err;
      // Long enough for a file lock to be released, short enough that a real
      // failure is still a fast one.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    }
  }
  throw last;
}

/**
 * On Windows, wrangler has been seen to apply every migration and then crash
 * in workerd teardown with a native stack trace (observed on the very first
 * run that creates .wrangler/state). The exit code is not the truth; the
 * migration table is. Apply, then verify.
 */
function applyMigrations(): void {
  try {
    wrangler('d1', 'migrations', 'apply', 'dads', '--local');
  } catch {
    // verified below
  }
  const status = wrangler('d1', 'migrations', 'list', 'dads', '--local');
  if (!status.includes('No migrations to apply')) {
    throw new Error(`local D1 is not fully migrated:\n${status}`);
  }
}

/**
 * Brings the local D1 that `wrangler dev` will serve to a known state: schema
 * applied, the e2e group present with a known code, and no members left over
 * from the previous run so "first visit" tests actually start from nothing.
 */
export default function globalSetup(): void {
  applyMigrations();

  // Via a file, not --command: a semicolon-separated statement list is not
  // something to trust to shell quoting on any platform.
  const slugs = GROUPS.map((g) => `'${g.slug}'`).join(', ');
  const reset = join(mkdtempSync(join(tmpdir(), 'dads-e2e-')), 'reset.sql');
  writeFileSync(
    reset,
    `DELETE FROM invites;\nDELETE FROM groups WHERE slug IN (${slugs});\nDELETE FROM join_attempts;\n`,
  );
  wrangler('d1', 'execute', 'dads', '--local', '-y', '--file', reset);

  for (const group of GROUPS) {
    run(
      'npx',
      [
        'tsx',
        'scripts/create-group.ts',
        '--slug',
        group.slug,
        '--name',
        group.name,
        '--code',
        group.code,
      ],
      'inherit',
    );
  }

  // A few days of questions behind the fit group.
  //
  // "What was asked before" carries the count of them, and a row with a
  // count on it is wider than the same row without one — which is why a
  // group that had never been asked anything fit a 360px phone and a real
  // one did not. A fixture with no history cannot see that.
  const seeded = join(mkdtempSync(join(tmpdir(), 'dads-e2e-')), 'asked.sql');
  writeFileSync(
    seeded,
    ['2026-09-01', '2026-09-02', '2026-09-03']
      .map(
        (day, i) =>
          `INSERT OR IGNORE INTO prompt_days (group_id, day, prompt_id)
             SELECT g.id, '${day}', p.id FROM groups g, prompts p
              WHERE g.slug = '${E2E_FIT_GROUP.slug}' AND p.group_id IS NULL
              ORDER BY p.id LIMIT 1 OFFSET ${i};`,
      )
      .join(' '),
  );
  wrangler('d1', 'execute', 'dads', '--local', '-y', '--file', seeded);
}
