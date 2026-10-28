import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Profile } from '../src/shared/profile';
import { todaysPrompt } from '../src/worker/prompts';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

describe('GET /api/profile', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  const join = async (name: string) =>
    cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
  const idOf = async (name: string) =>
    (await env.DB.prepare('SELECT id FROM members WHERE group_id = ? AND display_name = ?')
      .bind(group.id, name)
      .first<{ id: string }>())!.id;
  const get = (member: string, cookie: string) =>
    worker.fetch(`https://dads.test/api/profile?member=${member}`, { headers: { Cookie: cookie } });

  it('refuses a stranger', async () => {
    expect((await get('x', '')).status).toBe(401);
  });

  it('shows another dad: when he joined, his answers, his week', async () => {
    const marc = await join('Marc');
    await join('Sam');
    const sam = await idOf('Sam');
    const today = await todaysPrompt(env, group.id);
    await env.DB.prepare(
      `INSERT INTO messages (id, group_id, member_id, kind, body, created_at, prompt_id)
       VALUES ('m1', ?, ?, 'prompt', 'Fishing with my dad', ?, ?)`,
    )
      .bind(group.id, sam, Date.now(), today!.prompt.id)
      .run();

    const res = await get(sam, marc);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Profile;
    expect(body.name).toBe('Sam');
    expect(body.joinedAt).toBeGreaterThan(0);
    expect(body.answers?.map((a) => a.body)).toEqual(['Fishing with my dad']);
    expect(body.answers?.[0]?.question).toBe(today!.prompt.body);
    expect(body.events).toEqual([]);
    expect(body.week).toEqual({ checkIn: null, commitment: null });
  });

  it('leaves out what the room has switched off', async () => {
    const marc = await join('Marc');
    await env.DB.prepare('UPDATE groups SET questions_on = 0, week_on = 0 WHERE id = ?')
      .bind(group.id)
      .run();
    const body = (await (await get(await idOf('Marc'), marc)).json()) as Profile;
    expect(body.answers).toBeNull();
    expect(body.week).toBeNull();
  });

  it('does not find a dad from another room, or one who has left', async () => {
    const marc = await join('Marc');
    await join('Sam');
    const sam = await idOf('Sam');
    const other = await seedGroup();
    expect(other.id).not.toBe(group.id);
    expect((await get('nobody', marc)).status).toBe(404);

    await env.DB.prepare('UPDATE members SET gone_at = ? WHERE id = ?').bind(Date.now(), sam).run();
    expect((await get(sam, marc)).status).toBe(404);
  });
});
