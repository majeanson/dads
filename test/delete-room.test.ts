import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ServerFrame } from '../src/shared/protocol';
import { arrived, cookieFrom, postJoin, resetTables, until } from './helpers';

const worker = workerExports.default;

/**
 * Ending a room (2026-10-29).
 *
 * Nothing deleted a group before this, so there was no way to take a room's
 * photographs of children out of R2 short of wrangler. The creator can now,
 * armed and by name. These hold the whole of "with everything in it": D1,
 * both R2 prefixes, the sockets, the room's own storage — and nobody else's.
 */

async function roomOfMarcs(word: string, name = 'Marc’s') {
  const opened = await worker.fetch(
    new Request('https://dads.test/api/rooms/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code: word, displayName: 'Marc' }),
    }),
  );
  const marc = cookieFrom(opened);
  const marcId = ((await opened.json()) as { member: { id: string } }).member.id;
  const joined = await worker.fetch(
    postJoin({ code: word, displayName: 'Sam', deviceToken: 'd'.repeat(43) }),
  );
  const sam = cookieFrom(joined);
  const group = await env.DB.prepare('SELECT group_id FROM members WHERE id = ?')
    .bind(marcId)
    .first<{ group_id: string }>();
  return { marc, marcId, sam, groupId: group!.group_id };
}

const del = (cookie: string, body: unknown) =>
  worker.fetch('https://dads.test/api/rooms/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });

const count = async (sql: string, ...args: string[]) =>
  (await env.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n;

describe('deleting a room', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('is the creator’s, and asks for the name', async () => {
    const { marc, sam, groupId } = await roomOfMarcs('a word to delete');

    expect((await del(sam, { name: 'Marc’s' })).status).toBe(403);
    expect((await del(marc, { name: 'something else' })).status).toBe(400);
    expect((await del(marc, {})).status).toBe(400);
    expect((await del('', { name: 'Marc’s' })).status).toBe(401);
    expect(await count('SELECT COUNT(*) AS n FROM groups WHERE id = ?', groupId)).toBe(1);
  });

  it('takes the name however it is cased and spaced', async () => {
    const { marc, groupId } = await roomOfMarcs('a word to delete', 'The  Four');
    expect((await del(marc, { name: '  the four ' })).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM groups WHERE id = ?', groupId)).toBe(0);
  });

  it('removes the rows, the pictures and the faces, and only this room’s', async () => {
    const { marc, marcId, groupId } = await roomOfMarcs('a word to delete');
    const other = await roomOfMarcs('another room word', 'Elsewhere');

    await env.MEDIA.put(`${groupId}/pic-1`, 'x');
    await env.MEDIA.put(`${groupId}/pic-2`, 'x');
    await env.MEDIA.put(`faces/${groupId}/${marcId}`, 'x');
    await env.MEDIA.put(`${other.groupId}/pic-1`, 'keep');
    await env.MEDIA.put(`faces/${other.groupId}/${other.marcId}`, 'keep');
    await env.DB.prepare(
      `INSERT INTO messages (id, group_id, member_id, kind, body, created_at)
       VALUES ('m1', ?, ?, 'chat', 'hello', 1)`,
    )
      .bind(groupId, marcId)
      .run();
    await env.DB.prepare(
      "INSERT INTO oops (at, side, what, message, group_id) VALUES (1, 'web', 'test', 'boom', ?)",
    )
      .bind(groupId)
      .run();

    const res = await del(marc, { name: 'Marc’s' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Set-Cookie') ?? '').toContain('Max-Age=0');

    for (const table of ['members', 'messages', 'invites', 'oops']) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE group_id = ?`, groupId)).toBe(0);
    }
    expect((await env.MEDIA.list({ prefix: `${groupId}/` })).objects).toHaveLength(0);
    expect((await env.MEDIA.list({ prefix: `faces/${groupId}/` })).objects).toHaveLength(0);

    // Nobody else's was touched.
    expect(await count('SELECT COUNT(*) AS n FROM members WHERE group_id = ?', other.groupId)).toBe(
      2,
    );
    expect((await env.MEDIA.list({ prefix: `${other.groupId}/` })).objects).toHaveLength(1);
    expect((await env.MEDIA.list({ prefix: `faces/${other.groupId}/` })).objects).toHaveLength(1);
  });

  it('empties more than one page of pictures', async () => {
    const { marc, groupId } = await roomOfMarcs('a word to delete');
    for (let i = 0; i < 1100; i += 1) await env.MEDIA.put(`${groupId}/p${i}`, 'x');
    expect((await del(marc, { name: 'Marc’s' })).status).toBe(204);
    expect((await env.MEDIA.list({ prefix: `${groupId}/` })).objects).toHaveLength(0);
  }, 60_000);

  it('turns every open socket away, and the old cookie opens nothing', async () => {
    const { marc, sam } = await roomOfMarcs('a word to delete');
    const open = async (cookie: string) => {
      const res = await worker.fetch('https://dads.test/ws', {
        headers: { Upgrade: 'websocket', Cookie: cookie },
      });
      const ws = res.webSocket!;
      ws.accept();
      const dad = { frames: [] as ServerFrame[], closed: false };
      ws.addEventListener('message', (e) => {
        if (e.data !== 'pong') dad.frames.push(JSON.parse(e.data as string) as ServerFrame);
      });
      ws.addEventListener('close', () => {
        dad.closed = true;
      });
      await arrived(dad);
      return dad;
    };
    const marcs = await open(marc);
    const sams = await open(sam);

    expect((await del(marc, { name: 'Marc’s' })).status).toBe(204);

    await until(() => marcs.closed && sams.closed);
    expect(sams.frames.some((f) => f.t === 'removed')).toBe(true);
    expect(
      (await worker.fetch('https://dads.test/api/me', { headers: { Cookie: sam } })).status,
    ).toBeGreaterThanOrEqual(204);
    expect(
      (await worker.fetch('https://dads.test/api/me', { headers: { Cookie: sam } })).status,
    ).not.toBe(200);
  });

  it('frees the word for another room', async () => {
    const { marc } = await roomOfMarcs('a word to delete');
    expect((await del(marc, { name: 'Marc’s' })).status).toBe(204);
    const again = await worker.fetch(
      new Request('https://dads.test/api/rooms/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Again', code: 'a word to delete', displayName: 'Marc' }),
      }),
    );
    expect(again.status).toBeLessThan(300);
  });
});
