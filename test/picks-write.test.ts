import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PickItem } from '../src/shared/picks';
import { parseClientFrame, type ServerFrame } from '../src/shared/protocol';
import { cookieFrom, postJoin, resetTables, seedGroup, until, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * Putting a line on the list by hand: the routes, and the chat frame that the
 * add box sends. The list is mostly a view; what this pins is the part that is
 * not: whose line may be listed, who may take one off, and that a hand
 * category beats the classifier.
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
async function said(groupId: string, memberId: string | null, body: string, kind = 'chat') {
  const id = `msg_${(at += 1000)}`;
  await env.DB.prepare(
    `INSERT INTO messages (id, group_id, member_id, kind, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, groupId, memberId, kind, body, at)
    .run();
  return id;
}

function put(cookie: string, body: unknown): Promise<Response> {
  return worker.fetch('https://dads.test/api/picks', {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(cookie: string, id: string): Promise<Response> {
  return worker.fetch(`https://dads.test/api/picks?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
}

async function picks(cookie: string, only?: string): Promise<PickItem[]> {
  const narrow = only === undefined ? '' : `?only=${only}`;
  const res = await worker.fetch(`https://dads.test/api/picks${narrow}`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { picks: PickItem[] }).picks;
}

const rows = async () =>
  (
    await env.DB.prepare('SELECT * FROM line_picks').all<{
      message_id: string;
      member_id: string;
    }>()
  ).results;

const YT = 'https://youtu.be/dQw4w9WgXcQ';

describe('putting a line on the list by hand', () => {
  let group: SeededGroup;
  let marc: string;
  let leo: string;
  let marcId: string;
  let leoId: string;

  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
    marc = await comeIn(group, 'Marc');
    leo = await comeIn(group, 'Leo');
    marcId = await memberOf(group.id, 'Marc');
    leoId = await memberOf(group.id, 'Leo');
  });

  it('needs a session and a real category', async () => {
    const line = await said(group.id, marcId, 'Dune');
    expect((await put('', { id: line, category: 'read' })).status).toBe(401);
    expect((await del('', line)).status).toBe(401);
    expect((await put(marc, { id: line, category: 'eat' })).status).toBe(400);
    expect((await put(marc, { id: line })).status).toBe(400);
    expect((await put(marc, { category: 'read' })).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it('lists a line of words under the category he chose, with what was typed', async () => {
    const line = await said(group.id, marcId, 'Dune, the first one');
    expect(await picks(marc)).toEqual([]);
    expect((await put(leo, { id: line, category: 'read' })).status).toBe(200);
    const list = await picks(marc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: line,
      category: 'read',
      url: null,
      body: 'Dune, the first one',
      addedBy: leoId,
      name: 'Marc',
    });
    expect(await picks(marc, 'read')).toHaveLength(1);
    expect(await picks(marc, 'watch')).toHaveLength(0);
  });

  it('refuses another room’s line, the room’s furniture and an unknown id with a 404', async () => {
    const other = await seedGroup();
    const theirs = await said(other.id, null, 'Dune');
    const furniture = await said(group.id, null, 'Marc is here', 'system');
    for (const id of [theirs, furniture, 'msg_nope']) {
      expect((await put(marc, { id, category: 'read' })).status).toBe(404);
    }
    expect(await rows()).toEqual([]);
  });

  it('keeps the first dad who added it, and adding twice is harmless', async () => {
    const line = await said(group.id, marcId, 'Dune');
    await put(marc, { id: line, category: 'read' });
    expect((await put(leo, { id: line, category: 'watch' })).status).toBe(200);
    const [only, ...rest] = await rows();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ member_id: marcId, category: 'read' });
  });

  it('gives a recognised line no row, and it still lists under its own category', async () => {
    const line = await said(group.id, marcId, `this ${YT}`);
    expect((await put(marc, { id: line, category: 'read' })).status).toBe(200);
    expect(await rows()).toEqual([]);
    expect(await picks(marc)).toMatchObject([{ id: line, category: 'watch', addedBy: null }]);
  });

  it('lets a hand category win, and previews any address in the line', async () => {
    const short = await said(group.id, marcId, 'the third one https://amzn.to/abc123');
    await put(marc, { id: short, category: 'read' });
    const [item] = await picks(marc, 'read');
    expect(item).toMatchObject({ id: short, url: 'https://amzn.to/abc123', category: 'read' });
  });

  it('filters in the SQL: a rare category is not the newest few of everything', async () => {
    const book = await said(group.id, marcId, 'an old book title');
    await put(marc, { id: book, category: 'read' });
    // Far more recent lines than the bound, all of another kind.
    const bulk = Array.from({ length: 230 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO messages (id, group_id, member_id, kind, body, created_at)
         VALUES (?, ?, ?, 'chat', ?, ?)`,
      ).bind(`bulk_${i}`, group.id, marcId, YT, at + 100_000 + i),
    );
    for (let i = 0; i < bulk.length; i += 50) await env.DB.batch(bulk.slice(i, i + 50));
    expect((await picks(marc, 'read')).map((p) => p.id)).toEqual([book]);
    // A hand 'read' on a watch link is not shown under watch.
    const link = await said(group.id, marcId, `listen to this ${YT}x`);
    await env.DB.prepare(
      `INSERT INTO line_picks (message_id, group_id, member_id, category, created_at)
       VALUES (?, ?, ?, 'listen', ?)`,
    )
      .bind(link, group.id, marcId, Date.now())
      .run();
    expect((await picks(marc, 'listen')).map((p) => p.id)).toEqual([link]);
    expect((await picks(marc, 'watch')).map((p) => p.id)).not.toContain(link);
  });

  it('lets only the dad who added it take it off, and quietly', async () => {
    const line = await said(group.id, marcId, 'Dune');
    await put(leo, { id: line, category: 'read' });
    expect((await del(marc, line)).status).toBe(200);
    expect(await rows()).toHaveLength(1);
    expect((await del(leo, line)).status).toBe(200);
    expect(await rows()).toEqual([]);
    expect((await del(leo, 'msg_nope')).status).toBe(200);
    // The line itself is untouched.
    expect(
      await env.DB.prepare('SELECT 1 AS n FROM messages WHERE id = ?').bind(line).first(),
    ).not.toBeNull();
  });

  it('cannot take off another room’s row even by guessing the id', async () => {
    const other = await seedGroup();
    const dad = await comeIn(other, 'Sam');
    const line = await said(group.id, marcId, 'Dune');
    await put(marc, { id: line, category: 'read' });
    await del(dad, line);
    expect(await rows()).toHaveLength(1);
  });

  it('goes with the line when it is taken back, and with the room', async () => {
    const line = await said(group.id, marcId, 'Dune');
    await put(marc, { id: line, category: 'read' });
    // The retract path deletes the archive row; the cascade does the rest.
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(line).run();
    expect(await rows()).toEqual([]);

    const again = await said(group.id, marcId, 'Dune 2');
    await put(marc, { id: again, category: 'read' });
    await env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(group.id).run();
    expect(await rows()).toEqual([]);
  });

  it('refuses a cross-origin write', async () => {
    const line = await said(group.id, marcId, 'Dune');
    const res = await worker.fetch('https://dads.test/api/picks', {
      method: 'PUT',
      headers: {
        Cookie: marc,
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ id: line, category: 'read' }),
    });
    expect(res.status).toBe(403);
    expect(await rows()).toEqual([]);
  });
});

describe('the chat frame’s pick', () => {
  it('is optional, and one of the three when present', () => {
    expect(parseClientFrame(JSON.stringify({ t: 'chat', body: 'Dune' }))).toEqual({
      t: 'chat',
      body: 'Dune',
    });
    expect(parseClientFrame(JSON.stringify({ t: 'chat', body: 'Dune', pick: 'read' }))).toEqual({
      t: 'chat',
      body: 'Dune',
      pick: 'read',
    });
    for (const pick of ['eat', '', 3, null, ['read']]) {
      expect(parseClientFrame(JSON.stringify({ t: 'chat', body: 'Dune', pick }))).toBeNull();
    }
  });
});

describe('the add box, through the room', () => {
  let group: SeededGroup;
  let marc: string;
  let leo: string;
  const sockets: WebSocket[] = [];
  const frames = new WeakMap<WebSocket, ServerFrame[]>();

  async function open(cookie: string): Promise<WebSocket> {
    const res = await worker.fetch('https://dads.test/ws', {
      headers: { Upgrade: 'websocket', Cookie: cookie },
    });
    const ws = res.webSocket!;
    ws.accept();
    const got: ServerFrame[] = [];
    frames.set(ws, got);
    ws.addEventListener('message', (e) => {
      if (e.data !== 'pong') got.push(JSON.parse(e.data as string) as ServerFrame);
    });
    sockets.push(ws);
    await until(() => got.some((f) => f.t === 'hello'));
    return ws;
  }

  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
    marc = await comeIn(group, 'Marc');
    leo = await comeIn(group, 'Leo');
  });
  afterEach(() => sockets.splice(0).forEach((s) => s.close(1000, 'bye')));

  it('posts the line, lists it, stirs the room, and does nothing twice for a repeated cid', async () => {
    const m = await open(marc);
    const l = await open(leo);
    const send = (ws: WebSocket, extra: object) =>
      ws.send(JSON.stringify({ t: 'chat', body: 'Dune', cid: 'c-pick', ...extra }));

    send(m, { pick: 'read' });
    await until(() => frames.get(l)!.some((f) => f.t === 'stir' && f.what === 'picks'));
    const msg = frames.get(l)!.find((f) => f.t === 'msg');
    expect(msg).toMatchObject({ message: { body: 'Dune' } });

    expect(await picks(leo)).toMatchObject([{ body: 'Dune', category: 'read', url: null }]);
    const stirs = () => frames.get(l)!.filter((f) => f.t === 'stir' && f.what === 'picks').length;
    expect(stirs()).toBe(1);

    // The phone sends it again after a dropped echo.
    send(m, { pick: 'read' });
    await until(() => frames.get(m)!.filter((f) => f.t === 'msg').length === 2);
    expect(await rows()).toHaveLength(1);
    expect(stirs()).toBe(1);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>())!.n,
    ).toBe(1);
  });

  it('gives a recognised line no row but still stirs, and an old bundle’s frame still posts', async () => {
    const m = await open(marc);
    const l = await open(leo);
    m.send(JSON.stringify({ t: 'chat', body: `look ${YT}`, cid: 'c-a', pick: 'read' }));
    await until(() => frames.get(l)!.some((f) => f.t === 'stir' && f.what === 'picks'));
    expect(await rows()).toEqual([]);
    expect(await picks(leo)).toMatchObject([{ category: 'watch' }]);

    m.send(JSON.stringify({ t: 'chat', body: 'no pick here', cid: 'c-b' }));
    await until(() =>
      frames.get(l)!.some((f) => f.t === 'msg' && f.message.body === 'no pick here'),
    );
    expect(await rows()).toEqual([]);
  });

  it('drops the row when the line is taken back', async () => {
    const m = await open(marc);
    m.send(JSON.stringify({ t: 'chat', body: 'Dune', cid: 'c-gone', pick: 'read' }));
    await until(() => frames.get(m)!.some((f) => f.t === 'stir' && f.what === 'picks'));
    const sent = frames.get(m)!.find((f) => f.t === 'msg');
    const id = (sent as Extract<ServerFrame, { t: 'msg' }>).message.id;
    expect(await rows()).toHaveLength(1);
    m.send(JSON.stringify({ t: 'retract', id }));
    await until(() => frames.get(m)!.some((f) => f.t === 'gone'));
    expect(await rows()).toEqual([]);
    expect(await picks(marc)).toEqual([]);
  });
});
