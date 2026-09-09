import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../scripts/run';

/** The one group the e2e suite knows. Created fresh on every run. */
export const E2E_GROUP = { slug: 'e2e-dads', name: 'The E2E Dads', code: 'maple otter cedar fern' };

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
  const reset = join(mkdtempSync(join(tmpdir(), 'dads-e2e-')), 'reset.sql');
  writeFileSync(
    reset,
    `DELETE FROM groups WHERE slug = '${E2E_GROUP.slug}';\nDELETE FROM join_attempts;\n`,
  );
  wrangler('d1', 'execute', 'dads', '--local', '-y', '--file', reset);

  run(
    'npx',
    [
      'tsx',
      'scripts/create-group.ts',
      '--slug',
      E2E_GROUP.slug,
      '--name',
      E2E_GROUP.name,
      '--code',
      E2E_GROUP.code,
    ],
    'inherit',
  );
}
