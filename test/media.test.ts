import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerFrame } from '../src/shared/protocol';
import {
  KEPT_PER_GROUP,
  MEDIA_PER_GROUP,
  MAX_UPLOAD_BYTES,
  VOICE_PER_GROUP,
} from '../src/worker/media';
import {
  arrived,
  tick,
  until,
  cookieFrom,
  postJoin,
  resetTables,
  seedGroup,
  type SeededGroup,
} from './helpers';

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
  say(body: string, mediaId?: string, cid?: string) {
    const frame: Record<string, unknown> = { t: 'chat', body };
    if (mediaId !== undefined) frame.mediaId = mediaId;
    if (cid !== undefined) frame.cid = cid;
    this.ws.send(JSON.stringify(frame));
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
  const dad = new Dad(res.webSocket!, cookie);
  await arrived(dad);
  return dad;
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

/** A voice note. The bytes do not matter here; the declared type is what puts
 * it on the other shelf. */
async function sayOne(cookie: string, name = 'voice.webm') {
  const res = await put(cookie, PNG, {
    'Content-Type': 'audio/webm',
    'X-Dads-Filename': encodeURIComponent(name),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { media: { id: string }; dropped: number };
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
    // Declared oversize is refused before the bytes are read at all. Read from
    // the constant rather than repeating it: the cap moved once already, for
    // video, and a test that hard-codes it goes green on the wrong number.
    expect(
      (await put(cookie, PNG, { 'Content-Length': String(MAX_UPLOAD_BYTES + 1) })).status,
    ).toBe(413);
  });

  /**
   * A dad filming his kid on a swing is doing the same thing as photographing
   * him. A clip that downloads instead of playing is a clip nobody watches.
   */
  it('lets a video play inline, and still refuses a document', async () => {
    const cookie = await cookieFor(group);
    for (const declared of ['video/mp4', 'video/webm', 'video/quicktime']) {
      const body = (await (await put(cookie, PNG, { 'Content-Type': declared })).json()) as {
        media: { id: string; contentType: string };
      };
      expect(body.media.contentType).toBe(declared);

      const fetched = await worker.fetch(`https://dads.test/api/media?id=${body.media.id}`, {
        headers: { cookie },
      });
      expect(fetched.headers.get('Content-Type')).toBe(declared);
      // No disposition at all is what "render it where it lands" looks like;
      // the header only ever appears to force a download.
      expect(fetched.headers.get('Content-Disposition')).toBeNull();
    }

    // And the thing that has always been true stays true: HEIC is not on the
    // list, because Safari is the only browser that would render it.
    const heic = (await (await put(cookie, PNG, { 'Content-Type': 'image/heic' })).json()) as {
      media: { contentType: string };
    };
    expect(heic.media.contentType).toBe('application/octet-stream');
  });

  it('lets a voice note play where it lands, whichever browser recorded it', async () => {
    const cookie = await cookieFor(group);
    // No two browsers agree: Chrome and Firefox hand back webm, Safari mp4.
    // All of them have to play inline or the feature is a download button.
    for (const declared of ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac']) {
      const body = (await (await put(cookie, PNG, { 'Content-Type': declared })).json()) as {
        media: { id: string; contentType: string };
      };
      expect(body.media.contentType).toBe(declared);

      const fetched = await worker.fetch(`https://dads.test/api/media?id=${body.media.id}`, {
        headers: { cookie },
      });
      expect(fetched.headers.get('Content-Type')).toBe(declared);
      expect(fetched.headers.get('Content-Disposition')).toBeNull();
    }
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
      await tick();
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

  it('never lets a voice note push a photograph off the end', async () => {
    const cookie = await cookieFor(group);
    const photos: string[] = [];
    for (let i = 0; i < MEDIA_PER_GROUP; i++) {
      photos.push((await uploadOne(cookie, `photo-${i}.png`)).media.id);
      await tick();
    }

    // Two shelves. A week of talking is not a reason to throw away pictures of
    // somebody's children, which is what one shelf would have meant.
    for (let i = 0; i < 12; i++) {
      const said = await sayOne(cookie, `voice-${i}.webm`);
      expect(said.dropped).toBe(0);
      await tick();
    }

    const still = await worker.fetch(`https://dads.test/api/media?id=${photos[0]}`, {
      headers: { Cookie: cookie },
    });
    expect(still.status).toBe(200);

    const kept = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM media
        WHERE group_id = ? AND content_type LIKE 'image/%'`,
    )
      .bind(group.id)
      .first<{ n: number }>();
    expect(kept?.n).toBe(MEDIA_PER_GROUP);
  });

  it('holds thirty voice notes and then lets the oldest go', async () => {
    const cookie = await cookieFor(group);
    const first = (await sayOne(cookie, 'voice-0.webm')).media.id;
    await tick();
    for (let i = 1; i < VOICE_PER_GROUP; i++) {
      expect((await sayOne(cookie, `voice-${i}.webm`)).dropped).toBe(0);
      await tick();
    }

    expect((await sayOne(cookie, 'voice-last.webm')).dropped).toBe(1);
    const gone = await worker.fetch(`https://dads.test/api/media?id=${first}`, {
      headers: { Cookie: cookie },
    });
    expect(gone.status).toBe(404);
  });

  it('lists the photographs a room still holds, under a week of voice notes', async () => {
    const cookie = await cookieFor(group);
    const photo = (await uploadOne(cookie, 'photo.png')).media.id;
    await tick();
    // A chatty week. Both are still on their own shelves and both are still
    // held, so a listing bounded by one shelf would have answered with twelve
    // voice notes and no picture at all.
    for (let i = 0; i < 12; i++) {
      await sayOne(cookie, `voice-${i}.webm`);
      await tick();
    }

    const list = (await (
      await worker.fetch('https://dads.test/api/media-list', { headers: { Cookie: cookie } })
    ).json()) as { media: { id: string }[] };
    expect(list.media).toHaveLength(13);
    expect(list.media.map((m) => m.id)).toContain(photo);
  });

  it('counts each group’s ten separately', async () => {
    const other = await seedGroup();
    const mine = await cookieFor(group);
    const theirs = await cookieFor(other, 'Stranger');
    for (let i = 0; i < 3; i++) {
      await uploadOne(mine);
      await tick();
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

    const uploaded = await uploadOne(marc.cookie, 'pool.png');
    marc.say('he finally jumped in', uploaded.media.id);
    await until(() =>
      sam.frames.some((f) => f.t === 'msg' && f.message.body === 'he finally jumped in'),
    );
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
    const uploaded = await uploadOne(marc.cookie);
    marc.say('', uploaded.media.id);
    await until(() =>
      marc.frames.some(
        (f) => f.t === 'msg' && f.message.media !== null && f.message.kind === 'chat',
      ),
    );
  });

  it('refuses an attachment from another room rather than fetching it', async () => {
    const other = await seedGroup();
    const theirCookie = await cookieFor(other, 'Stranger');
    const theirs = await uploadOne(theirCookie);

    const marc = await enter(group, 'Marc');
    open.push(marc);
    marc.say('look at this', theirs.media.id);
    await until(() => marc.frames.some((f) => f.t === 'error' && f.code === 'no_media'));
    expect(marc.frames.some((f) => f.t === 'msg' && f.message.body === 'look at this')).toBe(false);
  });

  it('refuses an attachment a dad in this room did not upload', async () => {
    // Every media id in the room is already on the client, in its own
    // messages. Scoping the lookup to the GROUP and not to the SENDER let one
    // dad hang another man's photograph on a line of his own — and because
    // taking a line back takes its picture with it, retracting that line
    // deleted the blob and the record, so the photo vanished off the line the
    // man who took it had posted, with nothing to put it back.
    const sam = await enter(group, 'Sam');
    const marc = await enter(group, 'Marc');
    open.push(sam, marc);

    const his = await uploadOne(sam.cookie, 'his-kid.png');
    marc.say('mine now', his.media.id);
    await until(() => marc.frames.some((f) => f.t === 'error' && f.code === 'no_media'));
    expect(marc.frames.some((f) => f.t === 'msg' && f.message.body === 'mine now')).toBe(false);

    // And it is still there for the man it belongs to.
    const still = await worker.fetch(`https://dads.test/api/media?id=${his.media.id}`, {
      headers: { Cookie: sam.cookie },
    });
    expect(still.status).toBe(200);
  });

  it('refuses a picture that is already on a line', async () => {
    // A photograph belongs to ONE line. Nothing a dad can press sends the same
    // id twice, but the protocol allowed it — and because taking a line back
    // takes its picture with it, retracting either of the two deleted the blob
    // out from under the other, leaving a broken photograph on a line nobody
    // had touched.
    const marc = await enter(group, 'Marc');
    open.push(marc);

    const uploaded = await uploadOne(marc.cookie, 'once.png');
    marc.say('here he is', uploaded.media.id);
    await until(() => marc.frames.some((f) => f.t === 'msg' && f.message.body === 'here he is'));

    marc.say('and again', uploaded.media.id);
    await until(() => marc.frames.some((f) => f.t === 'error' && f.code === 'no_media'));
    expect(marc.frames.some((f) => f.t === 'msg' && f.message.body === 'and again')).toBe(false);
  });

  it('takes a re-sent line back silently, picture and all', async () => {
    // The phone in the dead spot re-sends what it was holding, and that is
    // the same line arriving twice rather than a second use of the picture.
    // It has to be DROPPED and not refused: an `error` frame drops the oldest
    // line in the outbox, so refusing a recovery would cost a dad a different
    // line entirely.
    const marc = await enter(group, 'Marc');
    open.push(marc);

    const uploaded = await uploadOne(marc.cookie, 'again.png');
    marc.say('in the pool', uploaded.media.id, 'c-recovered');
    await until(() => marc.frames.some((f) => f.t === 'msg' && f.message.body === 'in the pool'));
    marc.say('in the pool', uploaded.media.id, 'c-recovered');
    // A line the room will post, sent after the one it must drop: the socket
    // is handled in order, so once this is back the re-send has been dealt with.
    marc.say('and that was that');
    await until(() =>
      marc.frames.some((f) => f.t === 'msg' && f.message.body === 'and that was that'),
    );

    expect(
      marc.frames.filter((f) => f.t === 'msg' && f.message.body === 'in the pool'),
    ).toHaveLength(1);
    expect(marc.frames.some((f) => f.t === 'error')).toBe(false);
  });

  it('archives the attachment alongside the line', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);
    const uploaded = await uploadOne(marc.cookie);
    marc.say('for the record', uploaded.media.id);

    const row = () =>
      env.DB.prepare('SELECT media_id FROM messages WHERE group_id = ? AND body = ?')
        .bind(group.id, 'for the record')
        .first<{ media_id: string }>();
    await until(async () => (await row())?.media_id === uploaded.media.id);
  });

  it('quietly loses the picture once it has fallen off, rather than showing a broken one', async () => {
    const marc = await enter(group, 'Marc');
    open.push(marc);

    const uploaded = await uploadOne(marc.cookie, 'first.png');
    marc.say('the first one', uploaded.media.id);
    await until(() => marc.frames.some((f) => f.t === 'msg' && f.message.body === 'the first one'));

    // Push it off the end.
    for (let i = 0; i < MEDIA_PER_GROUP; i++) {
      await uploadOne(marc.cookie, `filler-${i}.png`);
      await tick();
    }

    const again = await enter(group, 'Marc');
    open.push(again);
    const hello = again.frames.find((x) => x.t === 'hello');
    if (hello?.t !== 'hello') throw new Error('unreachable');

    const line = hello.messages.find((m) => m.body === 'the first one');
    expect(line).toBeTruthy();
    expect(line?.media ?? null).toBeNull();
  });
});

/**
 * A photograph can be kept, and then the shelf cannot have it.
 *
 * The cap is still the feature — ten pictures, thirty voice notes — but the
 * thing that falls off is a photograph of somebody's child, which is the one
 * thing in here nobody would ever expect to be thrown away. What has to hold:
 * a kept picture survives any number of uploads, it does NOT take up a place
 * on the shelf, keeping is bounded, and an id from another room reaches
 * nothing.
 */
describe('keeping a photograph', () => {
  let group: SeededGroup;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
  });

  function keep(cookie: string, id: string, on: boolean) {
    return worker.fetch('https://dads.test/api/media/keep', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id, on }),
    });
  }

  it('survives a shelf-full of uploads, and does not take up a place', async () => {
    const cookie = await cookieFor(group);
    const first = (await uploadOne(cookie, 'the-one.png')).media.id;
    await tick();
    expect((await keep(cookie, first, true)).status).toBe(200);

    // A whole shelf on top of it, which without the keep would have taken it.
    for (let i = 0; i < MEDIA_PER_GROUP + 2; i++) {
      await uploadOne(cookie, `photo-${i}.png`);
      await tick();
    }

    const still = await worker.fetch(`https://dads.test/api/media?id=${first}`, {
      headers: { Cookie: cookie },
    });
    expect(still.status).toBe(200);

    // And the shelf is still a full shelf beside it: keeping a picture never
    // costs the room the next one.
    const unkept = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM media WHERE group_id = ? AND kept = 0',
    )
      .bind(group.id)
      .first<{ n: number }>();
    expect(unkept?.n).toBe(MEDIA_PER_GROUP);
  });

  it('goes back on the shelf when it is let go', async () => {
    const cookie = await cookieFor(group);
    const one = (await uploadOne(cookie, 'the-one.png')).media.id;
    await tick();
    await keep(cookie, one, true);
    expect((await keep(cookie, one, false)).status).toBe(200);

    for (let i = 0; i < MEDIA_PER_GROUP; i++) {
      await uploadOne(cookie, `photo-${i}.png`);
      await tick();
    }

    const gone = await worker.fetch(`https://dads.test/api/media?id=${one}`, {
      headers: { Cookie: cookie },
    });
    expect(gone.status).toBe(404);
  });

  it('is any dad’s to do, on anybody’s picture', async () => {
    // Unlike taking a line back, which is his alone: what the room keeps
    // belongs to the five of them.
    const marc = await cookieFor(group, 'Marc');
    const sam = await cookieFor(group, 'Sam');
    const his = (await uploadOne(marc, 'marcs.png')).media.id;
    expect((await keep(sam, his, true)).status).toBe(200);

    const row = await env.DB.prepare('SELECT kept FROM media WHERE id = ?')
      .bind(his)
      .first<{ kept: number }>();
    expect(row?.kept).toBe(1);
  });

  it('says so rather than quietly doing nothing when it is full', async () => {
    const cookie = await cookieFor(group);
    for (let i = 0; i < KEPT_PER_GROUP; i++) {
      const id = (await uploadOne(cookie, `keep-${i}.png`)).media.id;
      expect((await keep(cookie, id, true)).status).toBe(200);
      await tick();
    }

    const one = (await uploadOne(cookie, 'one-too-many.png')).media.id;
    const full = await keep(cookie, one, true);
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: 'keep_full' });

    // And letting one go makes room again.
    const letGo = await env.DB.prepare(
      'SELECT id FROM media WHERE group_id = ? AND kept = 1 LIMIT 1',
    )
      .bind(group.id)
      .first<{ id: string }>();
    await keep(cookie, letGo!.id, false);
    expect((await keep(cookie, one, true)).status).toBe(200);
  });

  it('is idempotent — two phones may both press it', async () => {
    const cookie = await cookieFor(group);
    const id = (await uploadOne(cookie, 'twice.png')).media.id;
    expect((await keep(cookie, id, true)).status).toBe(200);
    expect((await keep(cookie, id, true)).status).toBe(200);
  });

  it('never reaches another room', async () => {
    const other = await seedGroup();
    const stranger = await cookieFor(other, 'Somebody');
    const mine = (await uploadOne(await cookieFor(group), 'mine.png')).media.id;

    const res = await keep(stranger, mine, true);
    // Not found rather than forbidden: the shape of the refusal must not say
    // whether it exists somewhere else.
    expect(res.status).toBe(404);
  });

  it('refuses a body that is not an id and a boolean', async () => {
    const cookie = await cookieFor(group);
    const id = (await uploadOne(cookie, 'x.png')).media.id;
    expect((await keep(cookie, id, 'yes' as unknown as boolean)).status).toBe(400);
    expect((await keep(cookie, '', true)).status).toBe(400);
  });

  it('reaches every open phone, not just the one that asked', async () => {
    // Whether a photograph survives the next upload is a fact about the room.
    // Two dads looking at the same picture must not disagree about it.
    const marc = await enter(group, 'Marc');
    const sam = await enter(group, 'Sam');

    const id = (await uploadOne(marc.cookie, 'ours.png')).media.id;
    marc.say('look at this', id);
    await until(() => marc.frames.some((f) => f.t === 'msg' && f.message.body === 'look at this'));

    marc.frames.length = 0;
    expect((await keep(sam.cookie, id, true)).status).toBe(200);
    await until(() => marc.frames.some((f) => f.t === 'kept'));

    expect(marc.frames).toContainEqual({ t: 'kept', mediaId: id, on: true });

    marc.close();
    sam.close();
    await settle();
  });

  it('is still kept after a reload, because the backfill carries it', async () => {
    const marc = await enter(group, 'Marc');
    const id = (await uploadOne(marc.cookie, 'ours.png')).media.id;
    marc.say('look at this', id);
    await until(() => marc.frames.some((f) => f.t === 'msg' && f.message.body === 'look at this'));
    await keep(marc.cookie, id, true);
    marc.close();
    await settle();

    const again = await enter(group, 'Marc');
    const hello = again.frames.find((f) => f.t === 'hello');
    const line = hello!.messages.find((m) => m.media?.id === id);
    expect(line?.media?.kept).toBe(true);
    again.close();
    await settle();
  });

  it('needs a session', async () => {
    const res = await worker.fetch('https://dads.test/api/media/keep', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'whatever', on: true }),
    });
    expect(res.status).toBe(401);
  });
});
