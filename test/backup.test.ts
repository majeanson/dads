import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { BACKUP_TABLES, NOT_BACKED_UP } from '../src/shared/backupTables';

async function tablesInSchema(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
        AND name != 'd1_migrations'`,
  ).all<{ name: string }>();
  return results.map((r) => r.name).sort();
}

describe('the backup list', () => {
  it('covers every table the migrations create, or says why not', async () => {
    const covered = new Set<string>([...BACKUP_TABLES, ...Object.keys(NOT_BACKED_UP)]);
    const missing = (await tablesInSchema()).filter((t) => !covered.has(t));
    expect(missing, 'add to BACKUP_TABLES, or to NOT_BACKED_UP with a reason').toEqual([]);
  });

  it('names no table that does not exist, and none twice', async () => {
    const schema = new Set(await tablesInSchema());
    const listed = [...BACKUP_TABLES, ...Object.keys(NOT_BACKED_UP)];
    expect(listed.filter((t) => !schema.has(t))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });
});
