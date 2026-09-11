import { timingSafeEqual } from '../crypto';
import type { Env } from '../env';
import { IDENTITY_HEADERS } from '../RoomDO';

/**
 * Taking a line back out of the room.
 *
 * Everything else in this app is additive on purpose: a conversation is a
 * record, and a delete button is a way to rewrite what was said. This is not
 * that. It is an ops tool with no UI, gated on a secret that is absent unless
 * somebody set it, and it exists for two reasons.
 *
 * The first is the suite that runs against the live room. It joins as real
 * members and says real things, and cleaning up after itself in D1 is not
 * enough: the Durable Object serves the backfill from its own capped tail, so
 * a line deleted from the archive goes on appearing for everybody until five
 * hundred more have been said. Which, for five friends, is never.
 *
 * The second is the day somebody posts a photograph meant for a different
 * chat. There is no good answer to that which involves a migration.
 *
 * Matched on a LIKE pattern rather than an id because the lines this needs to
 * reach — "X is in.", "X, for dad night: …" — are the ROOM's own and carry no
 * author to key on.
 */
export async function forget(request: Request, env: Env): Promise<Response> {
  const secret = env.OPS_SECRET;
  // Not configured is not "forbidden": it is a route that does not exist, and
  // it should not be discoverable by the shape of its refusal.
  if (!secret) return Response.json({ error: 'not_found' }, { status: 404 });

  const offered = request.headers.get('X-Dads-Ops') ?? '';
  if (!timingSafeEqual(offered, secret)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  let body: { like?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Bounded at both ends. Too short and it is a pattern that matches the whole
  // room by accident, which is the one mistake this must not make easy.
  const like = typeof body.like === 'string' ? body.like : '';
  if (like.length < 4 || like.length > 200) {
    return Response.json({ error: 'bad_pattern' }, { status: 400 });
  }

  const archive = await env.DB.prepare('DELETE FROM messages WHERE body LIKE ?').bind(like).run();

  // And out of every room's own memory, or the backfill keeps handing them
  // back. One group today; the loop is what stops this becoming wrong when
  // there are two.
  const { results } = await env.DB.prepare('SELECT id FROM groups').all<{ id: string }>();
  let tail = 0;
  for (const group of results) {
    const stub = env.ROOM.get(env.ROOM.idFromName(group.id));
    const res = await stub.fetch('https://room/forget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [IDENTITY_HEADERS.groupId]: group.id },
      body: JSON.stringify({ like }),
    });
    if (res.ok) tail += ((await res.json()) as { dropped: number }).dropped;
  }

  return Response.json({ archive: archive.meta.changes ?? 0, tail });
}
