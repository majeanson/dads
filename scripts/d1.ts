import { run } from './run';

interface D1Result {
  results: Record<string, unknown>[];
}

/**
 * One statement against D1 through wrangler, with three goes at it. The first
 * backup of 2026-09-16 failed outright on a transient "account is not
 * authorized [code: 7403]" from Cloudflare and the second run succeeded; a
 * cron that hits that once backs up nothing that day and tells nobody.
 */
export function query(sql: string, remote: boolean): Record<string, unknown>[] {
  // One line: cmd.exe cannot carry a line break in an argument (`run.ts`).
  sql = sql.replace(/\s+/g, ' ').trim();
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
