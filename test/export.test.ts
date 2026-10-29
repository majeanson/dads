import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;

/**
 * "What do you keep of me" (2026-10-29): a dad's own words, as a file.
 */
describe('GET /api/export', () => {
  beforeEach(async () => {
    await resetTables();
  });

  async function twoDads() {
    const group = await seedGroup({ name: 'The Four' });
    const join = async (name: string) => {
      const res = await worker.fetch(
        postJoin({ code: group.code, displayName: name, deviceToken: name.padEnd(43, 'x') }),
      );
      return {
        cookie: cookieFrom(res),
        id: ((await res.json()) as { member: { id: string } }).member.id,
      };
    };
    return { group, marc: await join('Marc'), sam: await join('Sam') };
  }

  const get = (cookie: string) =>
    worker.fetch('https://dads.test/api/export', { headers: { Cookie: cookie } });

  it('is for the door’s members only', async () => {
    expect((await worker.fetch('https://dads.test/api/export')).status).toBe(401);
  });

  it('holds his lines, his week and nobody else’s, and downloads', async () => {
    const { group, marc, sam } = await twoDads();
    const line = (id: string, who: string, kind: string, body: string, at: number) =>
      env.DB.prepare(
        'INSERT INTO messages (id, group_id, member_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(id, group.id, who, kind, body, at)
        .run();
    await line('m1', marc.id, 'chat', 'first thing I said', 1_000);
    await line('m2', sam.id, 'chat', 'Sam’s secret', 2_000);
    await line('m3', marc.id, 'chat', 'second thing', 3_000);
    await line('m4', marc.id, 'system', 'Marc joined', 4_000);
    await env.DB.prepare(
      `INSERT INTO check_ins (id, group_id, member_id, week, rating, note, created_at, updated_at)
       VALUES ('c1', ?, ?, '2026-W44', 4, 'ok week', 5000, 5000)`,
    )
      .bind(group.id, marc.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO commitments (id, group_id, member_id, week, body, created_at)
       VALUES ('k1', ?, ?, '2026-W44', 'read to her', 5000)`,
    )
      .bind(group.id, marc.id)
      .run();

    const res = await get(marc.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="dads-the-four-marc.json"',
    );
    expect(res.headers.get('Cache-Control')).toContain('no-store');

    const file = (await res.json()) as {
      room: string;
      name: string;
      lines: { text: string }[];
      checkIns: { note: string }[];
      commitments: { text: string }[];
    };
    expect(file.room).toBe('The Four');
    expect(file.name).toBe('Marc');
    expect(file.lines.map((l) => l.text)).toEqual(['first thing I said', 'second thing']);
    expect(file.checkIns.map((c) => c.note)).toEqual(['ok week']);
    expect(file.commitments.map((c) => c.text)).toEqual(['read to her']);
    expect(JSON.stringify(file)).not.toContain('Sam’s secret');
  });
});
