import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewFromOEmbed, previewOf, readTags, youtubeVideo } from '../src/shared/unfurl';
import type { LinkCard } from '../src/worker/routes/unfurl';
import { cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * What a page says about itself, read off its tags.
 *
 * Pure, so these are pages written by hand: the Open Graph set every site
 * carries, Twitter's names when that is all there is, the plain <title> when
 * there is nothing else, and the ways a page can be slightly wrong without
 * being wrong enough to lose its card.
 */
describe('reading a page’s tags', () => {
  const page = (head: string) => `<!doctype html><html><head>${head}</head><body>x</body></html>`;

  it('prefers Open Graph, decodes entities and tidies whitespace', () => {
    const html = page(`
      <meta property="og:title" content="Tom &amp; Jerry&#x27;s   night" />
      <meta property="og:description" content="Two cats,
        one night." />
      <meta property="og:image" content="https://cdn.test/pic.jpg">
      <meta property="og:site_name" content="Films">
      <title>Should not be used</title>
    `);
    expect(previewOf(readTags(html), 'https://films.test/tom')).toEqual({
      title: "Tom & Jerry's night",
      description: 'Two cats, one night.',
      image: 'https://cdn.test/pic.jpg',
      site: 'Films',
    });
  });

  it('falls back to Twitter’s names, then the title, and names the host', () => {
    const twitter = page(
      `<meta name="twitter:title" content="On the bird site"><meta name="twitter:image" content="/t.png">`,
    );
    expect(previewOf(readTags(twitter), 'https://www.example.test/a/b')).toEqual({
      title: 'On the bird site',
      description: null,
      image: 'https://www.example.test/t.png',
      site: 'example.test',
    });

    const plain = page(
      `<title> Just a title </title><meta name="description" content="Said once">`,
    );
    expect(previewOf(readTags(plain), 'https://plain.test/')).toEqual({
      title: 'Just a title',
      description: 'Said once',
      image: null,
      site: 'plain.test',
    });
  });

  it('gives no card to a page with no title of any kind', () => {
    expect(
      previewOf(readTags(page(`<meta name="description" content="only this">`)), 'https://x.test'),
    ).toBeNull();
    expect(previewOf(new Map(), 'https://x.test')).toBeNull();
  });

  it('takes the first of each tag, in either attribute order and either quote', () => {
    const html = page(`
      <meta content='First' property='og:title'>
      <meta property="og:title" content="Second">
    `);
    expect(readTags(html).get('og:title')).toBe('First');
  });

  it('resolves a relative picture against the page and refuses one that is not http', () => {
    const relative = page(`<title>t</title><meta property="og:image" content="../p.png">`);
    expect(previewOf(readTags(relative), 'https://a.test/x/y/z')!.image).toBe(
      'https://a.test/x/p.png',
    );
    const data = page(
      `<title>t</title><meta property="og:image" content="data:image/png;base64,AAAA">`,
    );
    expect(previewOf(readTags(data), 'https://a.test/')!.image).toBeNull();
  });

  it('cuts a title that is a wall', () => {
    const long = 'word '.repeat(60).trim();
    const card = previewOf(readTags(page(`<title>${long}</title>`)), 'https://a.test/')!;
    expect(card.title.length).toBeLessThanOrEqual(120);
    expect(card.title.endsWith('…')).toBe(true);
  });

  it('knows a YouTube video from the rest of YouTube', () => {
    expect(youtubeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(youtubeVideo('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(youtubeVideo('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
    expect(youtubeVideo('https://www.youtube.com/')).toBe(false);
    expect(youtubeVideo('https://www.youtube.com/@somechannel')).toBe(false);
    expect(youtubeVideo('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
  });

  it('makes a card from oEmbed', () => {
    expect(
      previewFromOEmbed(
        {
          title: 'Never Gonna Give You Up',
          author_name: 'Rick Astley',
          thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          provider_name: 'YouTube',
        },
        'https://youtu.be/dQw4w9WgXcQ',
      ),
    ).toEqual({
      title: 'Never Gonna Give You Up',
      description: 'Rick Astley',
      image: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      site: 'YouTube',
    });
    expect(previewFromOEmbed({}, 'https://youtu.be/x')).toBeNull();
  });
});

/**
 * GET /api/unfurl — the Worker asks, remembers, and says nothing rather
 * than failing. The sites are a stub of `fetch`: every address the route
 * would reach for is answered here or not at all.
 */
let calls: string[] = [];
function sites(pages: Record<string, () => Response>) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const href =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(href);
    const page = pages[href];
    return page === undefined ? new Response('not found', { status: 404 }) : page();
  });
}

const html = (head: string, type = 'text/html; charset=utf-8') =>
  new Response(`<!doctype html><html><head>${head}</head><body></body></html>`, {
    headers: { 'Content-Type': type },
  });

let at = 1_700_000_000_000;
async function said(groupId: string, body: string): Promise<void> {
  const member = await env.DB.prepare('SELECT id FROM members WHERE group_id = ? LIMIT 1')
    .bind(groupId)
    .first<{ id: string }>();
  await env.DB.prepare(
    `INSERT INTO messages (id, group_id, member_id, kind, body, created_at)
     VALUES (?, ?, ?, 'chat', ?, ?)`,
  )
    .bind(`msg_${(at += 1000)}`, groupId, member?.id ?? null, body, at)
    .run();
}

async function unfurl(cookie: string, href: string): Promise<Response> {
  return worker.fetch(`https://dads.test/api/unfurl?url=${encodeURIComponent(href)}`, {
    headers: { Cookie: cookie },
  });
}

describe('a link in the room gets a card', () => {
  let group: SeededGroup;
  let cookie: string;

  beforeEach(async () => {
    await resetTables();
    await env.DB.prepare('DELETE FROM link_previews').run();
    group = await seedGroup();
    cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('needs a session and an http address', async () => {
    sites({});
    expect((await worker.fetch('https://dads.test/api/unfurl?url=https://a.test/')).status).toBe(
      401,
    );
    expect((await unfurl(cookie, 'javascript:alert(1)')).status).toBe(400);
    expect((await unfurl(cookie, 'ftp://a.test/x')).status).toBe(400);
    expect((await unfurl(cookie, '')).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('only asks about a link that is in one of this room’s lines', async () => {
    sites({ 'https://a.test/x': () => html('<title>A</title>') });
    const other = await seedGroup();
    await said(other.id, 'see https://a.test/x');
    expect((await unfurl(cookie, 'https://a.test/x')).status).toBe(404);
    expect(calls).toEqual([]);

    await said(group.id, 'see https://a.test/x');
    expect((await unfurl(cookie, 'https://a.test/x')).status).toBe(200);
    expect(calls).toEqual(['https://a.test/x']);
  });

  it('draws the card from the page’s tags and hands the picture through the Worker', async () => {
    sites({
      'https://films.test/tom': () =>
        html(`
          <meta property="og:title" content="Tom &amp; Jerry">
          <meta property="og:description" content="Two cats.">
          <meta property="og:image" content="/pic.jpg">
          <meta property="og:site_name" content="Films">
        `),
      'https://films.test/pic.jpg': () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'Content-Type': 'image/png' },
        }),
    });
    await said(group.id, 'watch https://films.test/tom tonight');
    const res = await unfurl(cookie, 'https://films.test/tom');
    expect(res.status).toBe(200);
    const card = (await res.json()) as LinkCard;
    expect(card.title).toBe('Tom & Jerry');
    expect(card.description).toBe('Two cats.');
    expect(card.site).toBe('Films');
    expect(card.image).toMatch(/^\/api\/unfurl\/image\?key=[0-9a-f]{64}$/);

    const image = await worker.fetch(`https://dads.test${card.image}`, {
      headers: { Cookie: cookie },
    });
    expect(image.status).toBe(200);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(calls).toEqual(['https://films.test/tom', 'https://films.test/pic.jpg']);
  });

  it('remembers the answer, so the room asks a page once', async () => {
    sites({ 'https://a.test/x': () => html('<title>A</title>') });
    await said(group.id, 'https://a.test/x');
    expect((await unfurl(cookie, 'https://a.test/x')).status).toBe(200);
    expect((await unfurl(cookie, 'https://a.test/x')).status).toBe(200);
    expect(calls).toEqual(['https://a.test/x']);
  });

  it('finds the address as a man types it, without the slash a browser adds', async () => {
    sites({ 'https://a.test/': () => html('<title>A</title>') });
    await said(group.id, 'go to https://a.test');
    expect((await unfurl(cookie, 'https://a.test/')).status).toBe(200);
  });

  it('says nothing for a page with nothing to say, a page that is not a page, or a site that is down', async () => {
    sites({
      'https://a.test/empty': () => html('<meta name="description" content="only">'),
      'https://a.test/json': () => html('<title>A</title>', 'application/json'),
      'https://a.test/boom': () => {
        throw new Error('connection refused');
      },
    });
    for (const path of ['empty', 'json', 'boom', 'missing']) {
      await said(group.id, `https://a.test/${path}`);
      const res = await unfurl(cookie, `https://a.test/${path}`);
      expect(res.status, path).toBe(204);
    }
  });

  it('asks YouTube through oEmbed', async () => {
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    sites({
      [`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`]: () =>
        Response.json({
          title: 'Never Gonna Give You Up',
          author_name: 'Rick Astley',
          thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          provider_name: 'YouTube',
        }),
    });
    await said(group.id, `this one ${watch}`);
    const res = await unfurl(cookie, watch);
    expect(res.status).toBe(200);
    const card = (await res.json()) as LinkCard;
    expect(card.title).toBe('Never Gonna Give You Up');
    expect(card.description).toBe('Rick Astley');
    expect(card.site).toBe('YouTube');
    expect(card.image).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('hands on only a raster picture a preview named, to a dad with a session', async () => {
    sites({
      'https://a.test/x': () =>
        html('<title>A</title><meta property="og:image" content="https://a.test/pic.svg">'),
      'https://a.test/pic.svg': () =>
        new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    });
    await said(group.id, 'https://a.test/x');
    const card = (await (await unfurl(cookie, 'https://a.test/x')).json()) as LinkCard;
    expect(card.image).not.toBeNull();

    const svg = await worker.fetch(`https://dads.test${card.image}`, {
      headers: { Cookie: cookie },
    });
    expect(svg.status).toBe(404);

    const noSession = await worker.fetch(`https://dads.test${card.image}`);
    expect(noSession.status).toBe(401);
    const badKey = await worker.fetch('https://dads.test/api/unfurl/image?key=nope', {
      headers: { Cookie: cookie },
    });
    expect(badKey.status).toBe(400);
    const unknown = await worker.fetch(`https://dads.test/api/unfurl/image?key=${'0'.repeat(64)}`, {
      headers: { Cookie: cookie },
    });
    expect(unknown.status).toBe(404);
  });
});
