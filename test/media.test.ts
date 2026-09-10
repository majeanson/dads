import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerFrame } from '../src/shared/protocol';
import { MEDIA_PER_GROUP } from '../src/worker/media';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

const settle = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A tiny but real PNG, so content types and sizes are not invented. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

class Dad {
  frames: ServerFrame[] = [];
  constructor(
    readonly ws: WebSocket,
    readonly cookie: string,
  ) {
    ws.accept();
    ws.addEventListener('message', (event) => {
      if (event.data === 'pong') return;
      this.frames.push(JSON.parse(event.data as string) as ServerFrame);
    });
  }
  say(body: string, mediaId?: string) {
    this.ws.send(
      JSON.stringify(mediaId === undefined ? { t: 'chat', body } : { t: 'chat', body, mediaId }),
    );
  }
  close() {
    this.ws.close(1000, 'bye');
  }
}

async function cookieFor(group: SeededGroup, name = 'Marc'): Promise<string> {
  return cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: name })));
}

async function enter(group: SeededGroup, name: string): Promise<Dad> {
  const cookie = await cookieFor(group, name);
  const res = await worker.fetch('https://dads.test/ws', {
    headers: { Upgrade: 'websocket', Cookie: cookie },
  });
  expect(res.status).toBe(101);
  return new Dad(res.webSocket!, cookie);
}

function put(cookie: string, body: BodyInit, headers: Record<string, string> = {}) {
  return worker.fetch('https://dads.test/api/media', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-Dads-Filename': 'photo.png',
      Cookie: cookie,
      ...headers,
    },
    body,
  });
}

async function uploadOne(cookie: string, name = 'photo.png') {
  const res = await put(cookie, PNG, { 'X-Dads-Filename': encodeURIComponent(name) });
  expect(res.status).toBe(200);
  return (await res.json()) as { media: { id: string; name: string }; dropped: number };
}

describe('uploading', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('refuses a stranger', async () => {
    const res = await worker.fetch('https://dads.test/api/media', { method: 'POST', body: PNG });
    expect(res.status).toBe(401);
  });

  it('stores the bytes and hands back what it takes to render them', async () => {
    const cookie = await cookieFor(group);
    const res = await put(cookie, PNG, {
      'X-Dads-Filename': encodeURIComponent('a photo.png'),
      'X-Dads-Width': '1600',
      'X-Dads-Height': '900',
    });
    const body = (await res.json()) as {
      media: {
        id: string;
        name: string;
        contentType: string;
        size: number;
        width: number;
        height: number;
      };
    };
    expect(body.media.name).toBe('a photo.png');
    expect(body.media.contentType).toBe('image/png');
    expect(body.media.size).toBe(PNG.byteLength);
    expect(body.media.width).toBe(1600);
    expect(body.media.height).toBe(900);
  });

  it('refuses an empty body and anything oversized', async () => {
    const cookie = await cookieFor(group);
    expect((await put(cookie, new Uint8Array(0))).status).toBe(400);
    // Declared oversize is refused before the bytes are read at all.
    expect((await put(cookie, PNG, { 'Content-Length': String(11 * 1024 * 1024) })).status).toBe(
      413,
    );
  });

  it('never lets a filename escape its own directory', async () => {
    const cookie = await cookieFor(group);
    const body = (await (
      await put(cookie, PNG, { 'X-Dads-Filename': encodeURIComponent('../../etc/passwd') })
    ).json()) as { media: { name: string } };
    expect(body.media.name).toBe('passwd');
  });

  it('survives a filename that is not valid percent-encoding', async () => {
    const cookie = await cookieFor(group);
    const body = (await (await put(cookie, PNG, { 'X-Dads-Filename': '%zz' })).json()) as {
      media: { name: string };
    };
    expect(body.media.name).toBe('%zz');
  });
});

describe('what a browser is allowed to render', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('refuses to remember a type that would run as a document', async () => {
    const cookie = await cookieFor(group);
    for (const declared of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml']) {
      const res = await put(cookie, PNG, { 'Content-Type': declared });
      const body = (await res.json()) as { media: { id: string; contentType: string } };
      // The bytes are kept exactly; the label that would make a browser run
      // them is not.
      expect(body.media.contentType).toBe('application/octet-stream');

      const fetched = await worker.fetch(`https://dads.test/api/media?id=${body.media.id}`, {
        headers: { Cookie: cookie },
      });
      expect(fetched.headers.get('Content-Type')).toBe('application/octet-stream');
      // Handed to the downloader, never to the renderer.
      expect(fetched.headers.get('Content-Disposition')).toContain('attachment');
      expect(fetched.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('lets a real photo render inline', async () => {
    const cookie = await cookieFor(group);
    const uploaded = await uploadOne(cookie);
    const res = await worker.fetch(`https://dads.test/api/media?id=${uploaded.media.id}`, {
      headers: { Cookie: cookie },
    });
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('the ten-photo cap', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('keeps the newest ten and drops the oldest silently', async () => {
    const cookie = await cookieFor(group);
    const ids: string[] = [];
    for (let i = 0; i < MEDIA_PER_GROUP; i++) {
      ids.push((await uploadOne(cookie, `photo-${i}.png`)).media.id);
      // created_at is the ordering key and the clock is coarse.
      await settle(2);
    }

    const full = await env.DB.prepare('SELECT COUNT(*) AS n FROM media WHERE group_id = ?')
      .bind(group.id)
      .first<{ n: number }>();
    expect(full?.n).toBe(MEDIA_PER_GROUP);

    const eleventh = await uploadOne(cookie, 'photo-10.png');
    expect(eleventh.dropped).toBe(1);

    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM media WHERE group_id = ?')
      .bind(group.id)
      .first<{ n: number }>();
    expect(after?.n).toBe(MEDIA_PER_GROUP);

    // The oldest is gone, record and blob together.
    const oldest = await worker.fetch(`https://dads.test/api/media?id=${ids[0]}`, {
      headers: { Cookie: cookie },
    });
    expect(oldest.status).toBe(404);
    expect(await env.MEDIA.get(`${group.id}/${ids[0]}`)).toBeNull();

    // The newest is fine.
    const newest = await worker.fetch(`https://dads.test/api/media?id=${eleventh.media.id}`, {
      headers: { Cookie: cookie },
    });
    expect(newest.status).toBe(200);
  });

  it('counts each group’s ten separately', async () => {
    const other = await seedGroup();
    const mine = await cookieFor(group);
    const theirs = await cookieFor(other, 'Stranger');
    for (let i = 0; i < 3; i++) {
      await uploadOne(mine);
      await settle(2);
    }
    await uploadOne(theirs);

    const list = (await (
      await worker.fetch('https://dads.test/api/media-list', { headers: { Cookie: theirs } })
    ).json()) as { media: unknown[] };
    expect(list.media).toHaveLength(1);
  });
});

describe('fetching', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  it('refuses a stranger and 404s an id from another room', async () => {
    const cookie = await cookieFor(group);
    const mine = await uploadOne(cookie);

    expect((await worker.fetch(`https://dads.test/api/media?id=${mine.media.id}`)).status).toBe(
      401,
    );

    const other = await seedGroup();
    const theirs = await cookieFor(other, 'Stranger');
    const peek = await worker.fetch(`https://dads.test/api/media?id=${mine.media.id}`, {
      headers: { Cookie: theirs },
    });
    // Not 403: another room's id resolves to nothing at all, which is also
    // what it should look like.
    expect(peek.status).toBe(404);
  });

  it('serves the bytes with their type, privately cached', async () => {
    const cookie = await cookieFor(group);
    const mine = await uploadOne(cookie);
    const res = await worker.fetch(`https://dads.test/api/media?id=${mine.media.id}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    // Never `public`: the response is only correct for the dad who asked.
    expect(res.headers.get('Cache-Control')).toContain('private');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });
});

describe('a photo in the conversation', () => {
  let group: SeededGroup;
  const open: Dad[] = [];

  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });
  afterEach(async () => {
    open.splice(0).forEach((d) => d.close());
    await settle();
  });

  it('reaches everyone, with what it takes to render it', async () => {
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');
    open.push(marc, sam);
    await settle();

    const uploaded = await uploadOne(marc.cookie, 'pool.png');
    marc.say('he finally jumped in', uploaded.media.id);
    await settle(140);

    const seen = sam.frames.find((f) => f.t === 'msg' && f.message.body === 'he finally jumped in');
    if (seen?.t !== 'msg') throw new Error('the line never arrived');
    expect(seen.message.media).toMatchObject({
      id: uploaded.media.id,
      name: 'pool.png',
      contentType: 'image/png',
    });
  });

  it('lets a photo stand on its own with no caption', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();
    const uploaded = await uploadOne(marc.cookie);
    marc.say('', uploaded.media.id);
    await settle(140);

    const seen = marc.frames.find(
      (f) => f.t === 'msg' && f.message.media !== null && f.message.kind === 'chat',
    );
    expect(seen).toBeTruthy();
  });

  it('refuses an attachment from another room rather than fetching it', async () => {
    const other = await seedGroup();
    const theirCookie = await cookieFor(other, 'Stranger');
    const theirs = await uploadOne(theirCookie);

    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();
    marc.say('look at this', theirs.media.id);
    await settle(140);

    expect(marc.frames.some((f) => f.t === 'error' && f.code === 'no_media')).toBe(true);
    expect(marc.frames.some((f) => f.t === 'msg' && f.message.body === 'look at this')).toBe(false);
  });

  it('archives the attachment alongside the line', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();
    const uploaded = await uploadOne(marc.cookie);
    marc.say('for the record', uploaded.media.id);
    await settle(160);

    const row = await env.DB.prepare(
      'SELECT media_id FROM messages WHERE group_id = ? AND body = ?',
    )
      .bind(group.id, 'for the record')
      .first<{ media_id: string }>();
    expect(row?.media_id).toBe(uploaded.media.id);
  });

  it('quietly loses the picture once it has fallen off, rather than showing a broken one', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    await settle();

    const uploaded = await uploadOne(marc.cookie, 'first.png');
    marc.say('the first one', uploaded.media.id);
    await settle(140);

    // Push it off the end.
    for (let i = 0; i < MEDIA_PER_GROUP; i++) {
      await uploadOne(marc.cookie, `filler-${i}.png`);
      await settle(2);
    }

    const again = await enter(group, 'Marc');
    open.push(again);
    const hello = await new Promise<ServerFrame>((resolve) => {
      const check = () => {
        const f = again.frames.find((x) => x.t === 'hello');
        if (f) resolve(f);
        else setTimeout(check, 20);
      };
      check();
    });
    if (hello.t !== 'hello') throw new Error('unreachable');

    const line = hello.messages.find((m) => m.body === 'the first one');
    expect(line).toBeTruthy();
    expect(line?.media ?? null).toBeNull();
  });
});
