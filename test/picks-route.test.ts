import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PickItem } from '../src/shared/picks';
import { PICKS_LIMIT } from '../src/worker/routes/picks';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * GET /api/picks — the lines that recommend something. What it has to get
 * right is what it leaves out: another room's lines, the room's furniture,
 * a link that only MENTIONS a site, and a line that has been taken back.
 */
async function comeIn(group: SeededGroup, name: string): Promise<string> {
  return cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
}

async function memberOf(groupId: string, name: string): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM members WHERE group_id = ? AND display_name = ?')
    .bind(groupId, name)
    .first<{ id: string }>();
  return row!.id;
}

let at = 1_700_000_000_000;
async function said(
  groupId: string,
  memberId: string | null,
  body: string,
  kind: 'chat' | 'system' | 'prompt' | 'table' = 'chat',
): Promise<string> {
  const id = `msg_${(at += 1000)}`;
  await env.DB.prepare(
    `INSERT INTO messages (id, group_id, member_id, kind, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, groupId, memberId, kind, body, at)
    .run();
  return id;
}

async function picks(cookie: string, only?: string): Promise<PickItem[]> {
  const narrow = only === undefined ? '' : `?only=${only}`;
  const res = await worker.fetch(`https://dads.test/api/picks${narrow}`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { picks: PickItem[] }).picks;
}

const YT = 'https://youtu.be/dQw4w9WgXcQ';
const SP = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';
const BOOK = 'https://www.goodreads.com/book/show/5107.The_Catcher';

describe('the list of picks', () => {
  let group: SeededGroup;
  let cookie: string;
  let marc: string;

  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
    cookie = await comeIn(group, 'Marc');
    marc = await memberOf(group.id, 'Marc');
  });

  it('needs a session', async () => {
    const res = await worker.fetch('https://dads.test/api/picks');
    expect(res.status).toBe(401);
  });

  it('lists recognised links newest first, with who, when and the category', async () => {
    const a = await said(group.id, marc, `watch this ${YT}`);
    const b = await said(group.id, marc, `listen ${SP}`);
    const list = await picks(cookie);
    expect(list.map((p) => p.id)).toEqual([b, a]);
    expect(list[0]).toMatchObject({ name: 'Marc', category: 'listen', url: SP, gone: false });
    expect(list[1]).toMatchObject({ category: 'watch', url: YT });
    expect(list[0]!.createdAt).toBeGreaterThan(list[1]!.createdAt);
  });

  it('leaves out plain links, lookalike hosts, the room’s furniture and other rooms', async () => {
    await said(group.id, marc, 'https://example.com/page');
    await said(group.id, marc, 'https://notyoutube.com/watch?v=dQw4w9WgXcQ');
    await said(group.id, marc, 'https://example.com/?u=youtube.com');
    await said(group.id, null, YT, 'system');
    const other = await seedGroup();
    await said(other.id, null, YT);
    expect(await picks(cookie)).toEqual([]);
  });

  it('includes an answer to a question, and narrows by category', async () => {
    await said(group.id, marc, YT);
    await said(group.id, marc, SP);
    await said(group.id, marc, `a book: ${BOOK}`, 'prompt');
    expect((await picks(cookie)).map((p) => p.category)).toEqual(['read', 'listen', 'watch']);
    expect((await picks(cookie, 'watch')).map((p) => p.category)).toEqual(['watch']);
    expect((await picks(cookie, 'listen')).map((p) => p.category)).toEqual(['listen']);
    expect((await picks(cookie, 'read')).map((p) => p.category)).toEqual(['read']);
    // Anything else is everybody's, not an error.
    expect(await picks(cookie, 'nonsense')).toHaveLength(3);
  });

  it('carries the line’s marks', async () => {
    const id = await said(group.id, marc, YT);
    await env.DB.prepare(
      `INSERT INTO reactions (message_id, member_id, emoji, group_id, created_at)
       VALUES (?, ?, '👍', ?, ?)`,
    )
      .bind(id, marc, group.id, Date.now())
      .run();
    const [only] = await picks(cookie);
    expect(only!.marks).toEqual([{ emoji: '👍', by: [marc] }]);
  });

  it('forgets a line that was taken back, and keeps one from a dad who left', async () => {
    const gone = await said(group.id, marc, YT);
    const left = await comeIn(group, 'Leo');
    expect(left).not.toBe('');
    const leo = await memberOf(group.id, 'Leo');
    await said(group.id, leo, SP);
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(gone).run();
    await env.DB.prepare('UPDATE members SET gone_at = ? WHERE id = ?').bind(Date.now(), leo).run();
    const list = await picks(cookie);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Leo', gone: true, category: 'listen' });
  });

  it('is bounded', async () => {
    const rows = Array.from({ length: PICKS_LIMIT + 5 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO messages (id, group_id, member_id, kind, body, created_at)
         VALUES (?, ?, ?, 'chat', ?, ?)`,
      ).bind(`bulk_${i}`, group.id, marc, YT, 1_800_000_000_000 + i),
    );
    for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
    expect(await picks(cookie)).toHaveLength(PICKS_LIMIT);
  });
});
