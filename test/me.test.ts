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

  it('can be changed after the door, and the room says so', async () => {
    const cookie = await comeIn(group, 'Marc');
    const res = await worker.fetch(put('/api/me/name', cookie, { name: 'Marc-antoine' }));
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT display_name FROM members WHERE group_id = ?')
      .bind(group.id)
      .first<{ display_name: string }>();
    expect(row?.display_name).toBe('Marc-antoine');

    // A name changing with nothing said is four men wondering who the new
    // bloke is, so the room carries a line — with the meta that lets it be
    // read in either language.
    const line = await env.DB.prepare(
      `SELECT body, meta FROM messages WHERE group_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(group.id)
      .first<{ body: string; meta: string | null }>();
    expect(line?.body).toBe('Marc goes by Marc-antoine now.');
    expect(JSON.parse(line?.meta ?? 'null')).toEqual({
      k: 'renamed',
      was: 'Marc',
      now: 'Marc-antoine',
    });
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
