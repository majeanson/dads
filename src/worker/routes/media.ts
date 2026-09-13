import type { Env } from '../env';
import { newId } from '../identity';
import { IDENTITY_HEADERS } from '../RoomDO';
import {
  isInlineSafe,
  keepMedia,
  keyFor,
  MAX_UPLOAD_BYTES,
  mediaFor,
  pruneMedia,
  recentMedia,
  safeContentType,
} from '../media';
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

/**
 * A filename for the download header, built from the id rather than from the
 * uploader's name: a header value cannot carry a quote or a newline safely,
 * and the real name is already shown in the room next to the link.
 */
function downloadName(id: string): string {
  return `${id.replace(/[^A-Za-z0-9_-]/g, '')}.bin`;
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

  // Never stored as declared. A browser that can be talked into rendering an
  // upload as text/html or image/svg+xml is running an uploader's script on
  // this app's own origin, with this app's session — so only a short list of
  // image types survives, and everything else becomes a byte stream.
  const contentType = safeContentType(request.headers.get('Content-Type') ?? '');
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
  // Belt to the allowlist's braces: never let a browser guess a type we did
  // not agree to, and hand anything but a known-safe image to the downloader
  // rather than to the renderer.
  headers.set('X-Content-Type-Options', 'nosniff');
  const type = headers.get('Content-Type') ?? 'application/octet-stream';
  if (!isInlineSafe(type)) {
    headers.set('Content-Disposition', `attachment; filename="${downloadName(id)}"`);
  }
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

/**
 * PUT /api/media/keep — a photograph is kept, or let go.
 *
 * The shelf is the feature: ten pictures to a room, and past that the oldest
 * goes. But the thing that goes is a photograph of somebody's child, and a
 * default is not an absolute. One tap takes a picture off the shelf, where
 * nothing will take it.
 *
 * Any dad, on anybody's picture — like the night and the three switches, and
 * not like retraction. Retracting is about what a man SAID and is his alone;
 * this is about what the room keeps, and a photo of five men at a barbecue
 * belongs to the five of them.
 *
 * Full is a real answer and not a silence: past KEPT_PER_GROUP the room says
 * so, because a switch that quietly did nothing would be a dad believing a
 * picture was safe when it was not.
 */
export async function keepMediaRoute(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: { id?: unknown; on?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; on?: unknown };
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const id = body.id;
  const on = body.on;
  if (typeof id !== 'string' || id === '' || id.length > 64 || typeof on !== 'boolean') {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const outcome = await keepMedia(env, session.group.id, id, on);
  // An id from another room is not found, not forbidden: the shape of the
  // refusal must not say whether it exists somewhere else.
  if (outcome === 'missing') return Response.json({ error: 'not_found' }, { status: 404 });
  if (outcome === 'full') return Response.json({ error: 'keep_full' }, { status: 409 });

  // Every open phone finds out, the way the night and the switches do:
  // whether a picture survives the next upload is a fact about the room, not
  // about the screen that asked.
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/kept', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify({ mediaId: id, on }),
  });

  return Response.json({ kept: on });
}
