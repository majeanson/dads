import type { Env } from '../env';
import { newId } from '../identity';
import { keyFor, MAX_UPLOAD_BYTES, mediaFor, pruneMedia, recentMedia } from '../media';
import { currentSession } from './auth';

const MAX_NAME = 120;

/**
 * Never trust a filename from a browser as a path.
 *
 * It arrives percent-encoded, because a header cannot carry every character a
 * filename can. A malformed encoding is a bad name, not a failed upload, so it
 * falls back to the raw string rather than throwing.
 *
 * The name is only ever a label — the R2 key is built from ids, never from
 * this — but it is stripped to its last segment anyway: the day somebody uses
 * it to build a path, it should already be safe.
 */
function safeName(raw: unknown): string {
  const encoded = typeof raw === 'string' ? raw : '';
  let name: string;
  try {
    name = decodeURIComponent(encoded);
  } catch {
    name = encoded;
  }
  const trimmed = name.replace(/[\r\n\t]/g, ' ').trim();
  const base = trimmed.split(/[\\/]/).pop() ?? '';
  return base.slice(0, MAX_NAME) || 'file';
}

function dimension(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 100_000 ? n : null;
}

/**
 * POST /api/media — the file as the raw request body.
 *
 * Raw rather than multipart: the client has already decided what it is
 * sending, the metadata is three headers, and it saves parsing a form on the
 * way in for no benefit.
 */
export async function uploadMedia(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_UPLOAD_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return Response.json({ error: 'empty' }, { status: 400 });
  // Content-Length can lie; the bytes cannot.
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  const contentType = (request.headers.get('Content-Type') ?? 'application/octet-stream')
    .split(';')[0]!
    .trim();
  const name = safeName(request.headers.get('X-Dads-Filename'));

  const id = newId('med');
  const key = `${session.group.id}/${id}`;

  await env.MEDIA.put(key, body, { httpMetadata: { contentType } });

  try {
    await env.DB.prepare(
      `INSERT INTO media
         (id, group_id, member_id, r2_key, name, content_type, size, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        session.group.id,
        session.member.id,
        key,
        name,
        contentType,
        body.byteLength,
        dimension(request.headers.get('X-Dads-Width')),
        dimension(request.headers.get('X-Dads-Height')),
        Date.now(),
      )
      .run();
  } catch (err) {
    // The blob is already up; without its record nothing can ever reach or
    // delete it, so take it back down rather than leave it paying rent.
    await env.MEDIA.delete(key).catch(() => {});
    throw err;
  }

  const dropped = await pruneMedia(env, session.group.id);
  const media = await mediaFor(env, session.group.id, id);
  return Response.json({ media, dropped });
}

/**
 * GET /api/media?id=… — the bytes.
 *
 * Behind the session check, and scoped to the caller's own group: an id from
 * another room resolves to nothing rather than to somebody else's photograph.
 */
export async function getMedia(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return new Response('unauthorized', { status: 401 });

  const id = url.searchParams.get('id');
  if (id === null) return new Response('missing id', { status: 400 });

  const key = await keyFor(env, session.group.id, id);
  if (key === null) return new Response('not found', { status: 404 });

  const object = await env.MEDIA.get(key);
  if (object === null) return new Response('not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Immutable: the id names these exact bytes and nothing ever rewrites them.
  // Private, because the response is only correct for the dad who asked.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}

/** GET /api/media-list — what the room still holds. */
export async function listMedia(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ media: await recentMedia(env, session.group.id) });
}
