import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/** A one-pixel PNG, which is all the bytes any of this needs. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

async function comeIn(group: SeededGroup, name: string): Promise<string> {
  return cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
}

function put(path: string, cookie: string, body: unknown): Request {
  return new Request(`https://dads.test${path}`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('a dad’s own name', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('can be changed after the door, and nothing is said about it', async () => {
    const cookie = await comeIn(group, 'Marc');
    const res = await worker.fetch(put('/api/me/name', cookie, { name: 'Marc-antoine' }));
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT display_name FROM members WHERE group_id = ?')
      .bind(group.id)
      .first<{ display_name: string }>();
    expect(row?.display_name).toBe('Marc-antoine');

    // And nothing is said about it. Who is who is the roster's job, and it
    // is one tap behind the head-count; a line in the conversation about a
    // man changing his name is the room talking about itself.
    const lines = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE group_id = ?')
      .bind(group.id)
      .first<{ n: number }>();
    expect(lines?.n).toBe(0);
  });

  it('refuses a stranger, an empty name and a very long one', async () => {
    const cookie = await comeIn(group, 'Marc');
    expect(
      (
        await worker.fetch(
          new Request('https://dads.test/api/me/name', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Nobody' }),
          }),
        )
      ).status,
    ).toBe(401);
    expect((await worker.fetch(put('/api/me/name', cookie, { name: '   ' }))).status).toBe(400);
    expect((await worker.fetch(put('/api/me/name', cookie, { name: 'x'.repeat(40) }))).status).toBe(
      400,
    );
  });

  it('says nothing when the name did not actually change', async () => {
    const cookie = await comeIn(group, 'Marc');
    await worker.fetch(put('/api/me/name', cookie, { name: 'Marc' }));
    const { results } = await env.DB.prepare('SELECT id FROM messages WHERE group_id = ?')
      .bind(group.id)
      .all();
    expect(results).toEqual([]);
  });
});

describe('a dad’s face', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  async function setFace(cookie: string, type = 'image/png'): Promise<Response> {
    return worker.fetch(
      new Request('https://dads.test/api/me/face', {
        method: 'PUT',
        headers: { cookie, 'Content-Type': type },
        body: PNG,
      }),
    );
  }

  function memberOf(): Promise<{ id: string } | null> {
    return env.DB.prepare('SELECT id FROM members WHERE group_id = ?')
      .bind(group.id)
      .first<{ id: string }>();
  }

  it('goes up, comes back, and is not a row on the photo shelf', async () => {
    const cookie = await comeIn(group, 'Marc');
    expect((await setFace(cookie)).status).toBe(200);

    const me = await memberOf();
    const got = await worker.fetch(
      new Request(`https://dads.test/api/face?member=${me!.id}`, { headers: { cookie } }),
    );
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Type')).toBe('image/png');
    expect((await got.arrayBuffer()).byteLength).toBe(PNG.byteLength);

    // A man's face must never be thrown away to make room for a picture of
    // somebody's barbecue, so it is not on that shelf at all.
    const { results } = await env.DB.prepare('SELECT id FROM media WHERE group_id = ?')
      .bind(group.id)
      .all();
    expect(results).toEqual([]);
  });

  it('is refused unless it is an image', async () => {
    const cookie = await comeIn(group, 'Marc');
    // The same reasoning as an attachment: this renders inline on everyone's
    // screen, and an SVG is a document that can carry script.
    expect((await setFace(cookie, 'image/svg+xml')).status).toBe(415);
    expect((await setFace(cookie, 'application/pdf')).status).toBe(415);
  });

  it('cannot be read from another group', async () => {
    const cookie = await comeIn(group, 'Marc');
    await setFace(cookie);
    const mine = await memberOf();

    const other = await seedGroup({ name: 'Other Dads', slug: 'other-dads' });
    const stranger = await comeIn(other, 'Stranger');
    const got = await worker.fetch(
      new Request(`https://dads.test/api/face?member=${mine!.id}`, {
        headers: { cookie: stranger },
      }),
    );
    expect(got.status).toBe(404);
  });

  it('can be taken off again', async () => {
    const cookie = await comeIn(group, 'Marc');
    await setFace(cookie);
    const res = await worker.fetch(
      new Request('https://dads.test/api/me/face', { method: 'DELETE', headers: { cookie } }),
    );
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT avatar_key, avatar_at FROM members WHERE group_id = ?')
      .bind(group.id)
      .first<{ avatar_key: string | null; avatar_at: number | null }>();
    expect(row?.avatar_key).toBeNull();
    expect(row?.avatar_at).toBeNull();
  });
});

describe('the glasses a dad wears', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  const worn = async () =>
    (
      await env.DB.prepare('SELECT glasses FROM members WHERE group_id = ?')
        .bind(group.id)
        .first<{ glasses: string | null }>()
    )?.glasses;

  it('are one of the list, and the app’s own shades are stored as nothing', async () => {
    const cookie = await comeIn(group, 'Marc');
    expect(
      (await worker.fetch(put('/api/me/glasses', cookie, { glasses: 'aviators' }))).status,
    ).toBe(200);
    expect(await worn()).toBe('aviators');

    expect((await worker.fetch(put('/api/me/glasses', cookie, { glasses: 'shades' }))).status).toBe(
      200,
    );
    expect(await worn()).toBeNull();
  });

  it('refuses a stranger, and anything off the list', async () => {
    const cookie = await comeIn(group, 'Marc');
    expect((await worker.fetch(put('/api/me/glasses', '', { glasses: 'round' }))).status).toBe(401);
    for (const glasses of ['monocle', '<b>', 42, null]) {
      expect((await worker.fetch(put('/api/me/glasses', cookie, { glasses }))).status).toBe(400);
    }
    expect(await worn()).toBeNull();
  });

  it('reach the room, and survive him changing his name', async () => {
    const cookie = await comeIn(group, 'Marc');
    await worker.fetch(put('/api/me/glasses', cookie, { glasses: 'round' }));

    const res = await worker.fetch('https://dads.test/ws', {
      headers: { Upgrade: 'websocket', Cookie: cookie },
    });
    const ws = res.webSocket!;
    ws.accept();
    const frames: { t: string; members?: { glasses?: string }[]; member?: { glasses?: string } }[] =
      [];
    ws.addEventListener('message', (e) => {
      if (e.data !== 'pong') frames.push(JSON.parse(e.data as string));
    });
    const wait = async (ok: () => boolean) => {
      for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
      expect(ok()).toBe(true);
    };

    // Everyone in the room is told who wears what on arriving...
    await wait(() => frames.some((f) => f.t === 'hello'));
    const hello = frames.find((f) => f.t === 'hello')!;
    expect(hello.members?.[0]?.glasses).toBe('round');

    // ...and a change of name, which does not know about glasses, must not
    // take them off anybody's screen.
    await worker.fetch(put('/api/me/name', cookie, { name: 'Marc-antoine' }));
    await wait(() => frames.some((f) => f.t === 'member'));
    expect(frames.find((f) => f.t === 'member')!.member?.glasses).toBe('round');
    ws.close(1000, 'bye');
  });
});
