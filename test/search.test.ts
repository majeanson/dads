import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Found } from '../src/shared/protocol';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * GET /api/search — the only way back to what was said.
 *
 * The room hands a browser five hundred lines and the archive keeps every
 * one, so everything a group said before that is in D1 and nowhere a dad can
 * reach it. What this has to get right is what it does NOT return: another
 * group's lines, the room's own furniture, and a wildcard that would empty
 * the archive into one result list.
 */
async function comeIn(group: SeededGroup, name: string): Promise<string> {
  return cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
}

async function memberOf(groupId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM members WHERE group_id = ? LIMIT 1')
    .bind(groupId)
    .first<{ id: string }>();
  return row!.id;
}

let at = 1_700_000_000_000;
async function said(
  groupId: string,
  memberId: string | null,
  body: string,
  kind: 'chat' | 'system' | 'prompt' | 'table' = 'chat',
  mediaId: string | null = null,
): Promise<string> {
  const id = `msg_${(at += 1000)}`;
  await env.DB.prepare(
    `INSERT INTO messages (id, group_id, member_id, kind, body, created_at, media_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, groupId, memberId, kind, body, at, mediaId)
    .run();
  return id;
}

async function find(cookie: string, q: string): Promise<Found[]> {
  const res = await worker.fetch(`https://dads.test/api/search?q=${encodeURIComponent(q)}`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: Found[] }).results;
}

describe('finding a line again', () => {
  let group: SeededGroup;
  let cookie: string;
  let marc: string;

  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
    cookie = await comeIn(group, 'Marc');
    marc = await memberOf(group.id);
  });

  it('needs a session', async () => {
    const res = await worker.fetch('https://dads.test/api/search?q=bedtime');
    expect(res.status).toBe(401);
  });

  it('finds what a dad typed, whatever case he typed it in', async () => {
    await said(group.id, marc, 'Bedtime is the hardest part of the day');
    const results = await find(cookie, 'bedtime');
    expect(results).toHaveLength(1);
    expect(results[0]!.body).toContain('Bedtime');
    expect(results[0]!.name).toBe('Marc');
    expect(results[0]!.memberId).toBe(marc);
  });

  it('returns the newest first, which is where a half-memory lives', async () => {
    await said(group.id, marc, 'bedtime, march');
    await said(group.id, marc, 'bedtime, april');
    const results = await find(cookie, 'bedtime');
    expect(results.map((r) => r.body)).toEqual(['bedtime, april', 'bedtime, march']);
  });

  it('leaves the room’s own lines out of it', async () => {
    // Furniture: nobody said it, and fifty of them would bury the one line
    // he was looking for.
    await said(group.id, null, 'The table’s open. Bedtime for the kids first.', 'system');
    await said(group.id, null, 'Marc took the table at bedtime', 'table');
    await said(group.id, marc, 'bedtime answer', 'prompt');
    const results = await find(cookie, 'bedtime');
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe('prompt');
  });

  it('never reaches another group', async () => {
    const other = await seedGroup();
    const stranger = await comeIn(other, 'Somebody');
    const strangerId = await memberOf(other.id);
    await said(other.id, strangerId, 'bedtime in the other house');
    await said(group.id, marc, 'bedtime here');

    expect((await find(cookie, 'bedtime')).map((r) => r.body)).toEqual(['bedtime here']);
    expect((await find(stranger, 'bedtime')).map((r) => r.body)).toEqual([
      'bedtime in the other house',
    ]);
  });

  it('treats a wildcard as a character, not as the whole archive', async () => {
    await said(group.id, marc, 'a line with nothing special in it');
    await said(group.id, marc, 'we split it 50%50 in the end');

    // A bare % would match every line in the group if it reached LIKE raw.
    expect(await find(cookie, '%')).toEqual([]);
    expect((await find(cookie, '50%50')).map((r) => r.body)).toEqual([
      'we split it 50%50 in the end',
    ]);
    // `_` is LIKE's single-character wildcard, and means an underscore here.
    expect(await find(cookie, '5_50')).toEqual([]);
  });

  it('says nothing for a query too short to mean anything', async () => {
    await said(group.id, marc, 'anything at all');
    expect(await find(cookie, 'a')).toEqual([]);
    expect(await find(cookie, ' ')).toEqual([]);
  });

  it('carries the attachment, so a found line looks like the line', async () => {
    await env.DB.prepare(
      `INSERT INTO media (id, group_id, member_id, r2_key, name, content_type, size,
                          width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('med_1', group.id, marc, 'k', 'bbq.jpg', 'image/jpeg', 100, 800, 600, at)
      .run();
    await said(group.id, marc, 'the barbecue', 'chat', 'med_1');

    const [found] = await find(cookie, 'barbecue');
    expect(found!.media).toEqual({
      id: 'med_1',
      name: 'bbq.jpg',
      contentType: 'image/jpeg',
      width: 800,
      height: 600,
      kept: false,
    });
  });

  it('still shows a line whose author has gone', async () => {
    const id = await said(group.id, marc, 'said before he left');
    await env.DB.prepare('UPDATE messages SET member_id = NULL WHERE id = ?').bind(id).run();
    const [found] = await find(cookie, 'before he left');
    expect(found!.memberId).toBeNull();
    expect(found!.name).toBe('');
  });
});
