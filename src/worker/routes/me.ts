import type { Env } from '../env';
import { currentSession, MAX_NAME_LENGTH } from './auth';

import { isImage, MAX_UPLOAD_BYTES, safeContentType } from '../media';

/**
 * A dad's own name and face.
 *
 * The name was settable exactly once, at the door, and changing it meant
 * signing out and rejoining — which in this app means arriving as a stranger
 * with none of your history. The face is new and is deliberately NOT a
 * `media` row: a photograph posted to the room counts against a shelf of ten
 * and gets pruned, and a man's own face must never be thrown away to make
 * room for a picture of somebody's barbecue.
 *
 * One R2 object per dad, overwritten in place. A group of five owns five of
 * them for ever, however many times they change their minds.
 */

/** Faces are shown at 40 pixels and stored small; the browser shrinks first. */
const MAX_FACE_BYTES = 512 * 1024;

function faceKey(groupId: string, memberId: string): string {
  return `faces/${groupId}/${memberId}`;
}

/**
 * Tell the room, so the roster on every open phone changes now rather than
 * at the next reconnect — and so a rename gets its line.
 *
 * Best effort from end to end: the change is already in D1, and a room that
 * did not hear about it is a roster that catches up the next time anybody
 * opens a socket. Never worth failing the request a dad just made.
 */
async function tellTheRoom(
  env: Env,
  groupId: string,
  body: { memberId: string; name: string; face: number | null; was?: string },
): Promise<void> {
  try {
    const stub = env.ROOM.get(env.ROOM.idFromName(groupId));
    await stub.fetch('https://room/member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, groupId }),
    });
  } catch (err) {
    console.error('me: the room did not hear about it', err);
  }
}

/** PUT /api/me/name — { name } */
export async function putName(request: Request, env: Env, prod: boolean): Promise<Response> {
  const session = await currentSession(request, env, prod);
  if (!session) return new Response('no', { status: 401 });

  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return Response.json({ error: 'bad_body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return Response.json({ error: 'missing_name' }, { status: 400 });
  // Counted in code points, like the door does it: a name of emoji is not a
  // name of 32 bytes.
  if ([...name].length > MAX_NAME_LENGTH) {
    return Response.json({ error: 'name_too_long' }, { status: 400 });
  }

  const was = session.member.displayName;
  if (name === was) return Response.json({ ok: true, name });

  await env.DB.prepare('UPDATE members SET display_name = ? WHERE id = ?')
    .bind(name, session.member.id)
    .run();

  await tellTheRoom(env, session.group.id, {
    memberId: session.member.id,
    name,
    face: session.member.avatarAt ?? null,
    was,
  });
  return Response.json({ ok: true, name });
}

/**
 * PUT /api/me/face — the image bytes, with its type in Content-Type.
 *
 * Images only, and the allowlist is the one the room already uses: a face is
 * rendered inline on everyone's screen, so the reasoning about SVG carrying
 * script applies here exactly as it does to an attachment.
 */
export async function putFace(request: Request, env: Env, prod: boolean): Promise<Response> {
  const session = await currentSession(request, env, prod);
  if (!session) return new Response('no', { status: 401 });

  const declared = safeContentType(request.headers.get('Content-Type') ?? '');
  if (!isImage(declared)) return Response.json({ error: 'not_an_image' }, { status: 415 });

  // Before the body is read, not after: buffering a hundred megabytes into
  // the isolate to then refuse it turns a 413 into a 500. The length is the
  // client's claim, so the real check below still stands.
  const cap = Math.min(MAX_FACE_BYTES, MAX_UPLOAD_BYTES);
  const claimed = Number(request.headers.get('Content-Length') ?? '');
  if (Number.isFinite(claimed) && claimed > cap) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return Response.json({ error: 'empty' }, { status: 400 });
  if (bytes.byteLength > cap) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }

  const key = faceKey(session.group.id, session.member.id);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: declared } });

  const at = Date.now();
  await env.DB.prepare('UPDATE members SET avatar_key = ?, avatar_at = ? WHERE id = ?')
    .bind(key, at, session.member.id)
    .run();

  await tellTheRoom(env, session.group.id, {
    memberId: session.member.id,
    name: session.member.displayName,
    face: at,
  });
  return Response.json({ ok: true, face: at });
}

/** DELETE /api/me/face */
export async function deleteFace(request: Request, env: Env, prod: boolean): Promise<Response> {
  const session = await currentSession(request, env, prod);
  if (!session) return new Response('no', { status: 401 });

  await env.MEDIA.delete(faceKey(session.group.id, session.member.id)).catch((err: unknown) => {
    console.error('me: could not delete a face', err);
  });
  await env.DB.prepare('UPDATE members SET avatar_key = NULL, avatar_at = NULL WHERE id = ?')
    .bind(session.member.id)
    .run();

  await tellTheRoom(env, session.group.id, {
    memberId: session.member.id,
    name: session.member.displayName,
    face: null,
  });
  return Response.json({ ok: true });
}

/**
 * GET /api/face?member=…&v=…
 *
 * Behind the session and scoped to the caller's own group, like every other
 * object in the bucket: these are photographs of people, and a member id from
 * another room reaches nothing.
 *
 * Cached hard because the URL carries the version — a new face is a new `v`
 * and therefore a new URL, so nothing ever has to be revalidated. `private`,
 * because whatever sits between a dad and this is not entitled to keep it.
 */
export async function getFace(
  request: Request,
  env: Env,
  url: URL,
  prod: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, prod);
  if (!session) return new Response('no', { status: 401 });

  const memberId = url.searchParams.get('member') ?? '';
  if (!memberId) return new Response('no member', { status: 400 });

  const row = await env.DB.prepare('SELECT avatar_key FROM members WHERE id = ? AND group_id = ?')
    .bind(memberId, session.group.id)
    .first<{ avatar_key: string | null }>();
  if (!row?.avatar_key) return new Response('no face', { status: 404 });

  const object = await env.MEDIA.get(row.avatar_key);
  if (object === null) return new Response('no face', { status: 404 });

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
