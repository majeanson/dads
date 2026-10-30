import {
  fetchable,
  previewFromOEmbed,
  previewOf,
  readTags,
  youtubeVideo,
  type LinkPreview,
} from '../../shared/unfurl';
import type { Env } from '../env';
import { currentSession } from './auth';

/**
 * GET /api/unfurl?url= — what a link in the conversation says about itself.
 *
 * The Worker does the asking, never the phone: a dad reading the room should
 * not have every site anybody pasted learn his address and the moment he
 * looked, and a page's tags are the same for everyone, so one fetch serves
 * the room for a week (`link_previews`). The picture comes through the Worker
 * for the same reason (`getUnfurlImage`), and only a picture a preview
 * named — the key is the preview's, so the route is not a proxy for
 * anything else.
 *
 * Only a link that is IN one of this room's lines. A session is a dad, but a
 * route that fetched any address a dad named would be a fetch of anything
 * from Cloudflare's address on his say-so; the conversation is what it is
 * for, so the conversation is what it checks.
 *
 * A page with nothing to say is 204, remembered for a day. A page that
 * cannot be reached is the same 204: the line is still his line, with or
 * without a card, and nothing about a card is worth an error on a phone.
 */

/** A week for a card; a day for "nothing there", which a dead link may stop being. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_NOTHING_MS = 24 * 60 * 60 * 1000;
/** A line is 2000 characters, so an address in one is too. */
const MAX_URL = 2000;
/** The head is the first few kilobytes; this is a wide margin past it. */
const MAX_HTML = 512 * 1024;
/** A thumbnail. Five megabytes is a photograph, and a card is not one. */
const MAX_IMAGE = 5 * 1024 * 1024;
const FETCH_MS = 8000;
const UA = 'dads-preview/1 (+https://dads.marcportal.com)';

const IMAGE_TYPES = /^image\/(jpeg|png|gif|webp|avif)\b/i;

interface Row {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site: string | null;
  expires_at: number;
}

/** What the phone gets. The image is the Worker's address for it, never the site's. */
export interface LinkCard {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  site: string;
}

export async function getUnfurl(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const href = url.searchParams.get('url') ?? '';
  const link = href.length <= MAX_URL ? fetchable(href) : null;
  if (link === null) return Response.json({ error: 'bad_url' }, { status: 400 });
  if (isProduction && privateHost(link.hostname)) return nothing();

  if (!(await inTheRoom(env, session.group.id, link.toString()))) {
    return Response.json({ error: 'unknown_link' }, { status: 404 });
  }

  const key = await hashOf(link.toString());
  const now = Date.now();
  const kept = await env.DB.prepare(
    `SELECT url, title, description, image_url, site, expires_at
       FROM link_previews WHERE url_hash = ?`,
  )
    .bind(key)
    .first<Row>();

  if (kept !== null && kept.expires_at > now) return answer(kept, key);

  const preview = await fetchPreview(link.toString());
  const row: Row = {
    url: link.toString(),
    title: preview?.title ?? null,
    description: preview?.description ?? null,
    image_url: preview?.image ?? null,
    site: preview?.site ?? null,
    expires_at: now + (preview === null ? KEEP_NOTHING_MS : KEEP_MS),
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR REPLACE INTO link_previews
         (url_hash, url, title, description, image_url, site, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(key, row.url, row.title, row.description, row.image_url, row.site, now, row.expires_at),
    env.DB.prepare('DELETE FROM link_previews WHERE expires_at < ?').bind(now),
  ]);
  return answer(row, key);
}

/**
 * GET /api/unfurl/image?key= — a card's picture, through the Worker.
 *
 * Streamed, not stored: the site already holds it, and the browser keeps its
 * copy for a day. Only a known-safe raster type is passed on, named with
 * `nosniff`; an SVG is a script, and anything else is nothing.
 */
export async function getUnfurlImage(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return new Response('unauthorized', { status: 401 });

  const key = url.searchParams.get('key') ?? '';
  if (!/^[0-9a-f]{64}$/.test(key)) return new Response('missing key', { status: 400 });
  const row = await env.DB.prepare('SELECT image_url FROM link_previews WHERE url_hash = ?')
    .bind(key)
    .first<{ image_url: string | null }>();
  const src = row?.image_url ?? null;
  if (src === null) return new Response('not found', { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(src, {
      headers: { 'User-Agent': UA, Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_MS),
      cf: { cacheEverything: true, cacheTtl: 24 * 60 * 60 },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
  const type = upstream.headers.get('Content-Type') ?? '';
  const length = Number(upstream.headers.get('Content-Length') ?? 0);
  if (!upstream.ok || upstream.body === null || !IMAGE_TYPES.test(type) || length > MAX_IMAGE) {
    await upstream.body?.cancel().catch(() => undefined);
    return new Response('not found', { status: 404 });
  }
  return new Response(upstream.body.pipeThrough(capped(MAX_IMAGE)), {
    headers: {
      'Content-Type': type.split(';')[0]!.trim(),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Fetches the page and reads its tags; YouTube is asked through oEmbed
 * first. Every failure is "nothing": a timeout, a 403 for a bot, a page that
 * is not HTML, a site that is down tonight.
 */
export async function fetchPreview(href: string): Promise<LinkPreview | null> {
  if (youtubeVideo(href)) {
    const card = await fromOEmbed(href);
    if (card !== null) return card;
  }
  try {
    const res = await fetch(href, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'en,fr;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const type = res.headers.get('Content-Type') ?? '';
    if (!res.ok || res.body === null || !/^(text\/html|application\/xhtml\+xml)\b/i.test(type)) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const html = await readUpTo(res.body, MAX_HTML);
    // The tags are read against the address the page ENDED UP at: a relative
    // picture on a page reached through a redirect is relative to there.
    return previewOf(readTags(html), res.url || href);
  } catch {
    return null;
  }
}

async function fromOEmbed(href: string): Promise<LinkPreview | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(href)}&format=json`,
      {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_MS),
      },
    );
    if (!res.ok) return null;
    return previewFromOEmbed((await res.json()) as Record<string, unknown>, href);
  } catch {
    return null;
  }
}

/** Is this address in a line somebody typed in this room. The two forms are
 * the address as a browser writes it and as a man types it (no trailing slash). */
async function inTheRoom(env: Env, groupId: string, href: string): Promise<boolean> {
  const typed = href.endsWith('/') ? href.slice(0, -1) : href;
  const row = await env.DB.prepare(
    `SELECT 1 AS one FROM messages
      WHERE group_id = ?1 AND kind IN ('chat', 'prompt')
        AND (instr(body, ?2) > 0 OR instr(body, ?3) > 0)
      LIMIT 1`,
  )
    .bind(groupId, href, typed)
    .first<{ one: number }>();
  return row !== null;
}

function answer(row: Row, key: string): Response {
  if (row.title === null) return nothing();
  const card: LinkCard = {
    url: row.url,
    title: row.title,
    description: row.description,
    image: row.image_url === null ? null : `/api/unfurl/image?key=${key}`,
    site: row.site ?? '',
  };
  return Response.json(card, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}

function nothing(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, max-age=3600' } });
}

/**
 * An address nothing on the public internet answers to. The Worker cannot
 * reach a private network either way; this keeps it from trying, and keeps
 * the Worker from fetching itself in a loop on its own hostname. Outside
 * production, localhost is where the whole stack lives.
 */
function privateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^\[?::1\]?$/.test(host)) return true;
  return /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

async function hashOf(href: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(href));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readUpTo(body: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let read = 0;
  while (read < max) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    text += decoder.decode(value, { stream: true });
    // Everything a card needs is in the head; once it has closed, the rest
    // of the page is a download for nothing.
    if (/<\/head\s*>/i.test(text)) break;
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

/** Passes bytes through up to a ceiling, then stops the stream. */
function capped(max: number): TransformStream<Uint8Array, Uint8Array> {
  let passed = 0;
  return new TransformStream({
    transform(chunk, controller) {
      passed += chunk.byteLength;
      if (passed > max) controller.error(new Error('too big'));
      else controller.enqueue(chunk);
    },
  });
}
