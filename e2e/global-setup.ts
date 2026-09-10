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
const GROUPS = [
  E2E_CALL_GROUP,
  E2E_GROUP,
  E2E_ROOM_GROUP,
  E2E_NIGHT_GROUP,
  E2E_PROMPT_GROUP,
  E2E_BOARD_GROUP,
  E2E_TABLE_GROUP,
];

function wrangler(...args: string[]): string {
  return run('npx', ['wrangler', ...args]);
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
    `DELETE FROM groups WHERE slug IN (${slugs});\nDELETE FROM join_attempts;\n`,
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
}
