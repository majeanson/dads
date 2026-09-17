import { hashDeviceToken } from '../crypto';
import type { Env } from '../env';
import { sessionSecret } from '../env';
import { identityCookie, signIdentity } from '../identity';
import { currentSession } from './auth';

/**
 * The rooms this device is in, and moving between them.
 *
 * A dad could always be in more than one — the device token is looked up per
 * group, so joining a second room never cost him the first, and typing the
 * first room's word again brought him back as himself with all his history.
 * What he could not do was find his way back without that word written down
 * somewhere, and nothing in the app ever said which rooms he was in.
 *
 * The device token is what proves it, here as at the door: it is 256 random
 * bits this Worker issued, kept in localStorage and stored only as an HMAC.
 * A man holding it is the man who joined, which is exactly the claim being
 * made — so switching needs no password and cannot reach a room he was never
 * let into.
 */

interface RoomRow {
  id: string;
  name: string;
  slug: string;
  member_id: string;
  display_name: string;
  last_seen: number;
}

async function roomsFor(env: Env, token: string, isProduction: boolean): Promise<RoomRow[]> {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return [];
  const hash = await hashDeviceToken(sessionSecret(env, isProduction), token);
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.name, g.slug, m.id AS member_id, m.display_name, m.last_seen
       FROM members m JOIN groups g ON g.id = m.group_id
      WHERE m.device_token_hash = ?
      ORDER BY m.last_seen DESC`,
  )
    .bind(hash)
    .all<RoomRow>();
  return results;
}

/** POST /api/rooms/mine — { deviceToken } */
export async function listMine(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  // The cookie is not enough and not the point: it names ONE room, and the
  // question here is which others this browser belongs to.
  let body: { deviceToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const token = typeof body.deviceToken === 'string' ? body.deviceToken : '';
  const session = await currentSession(request, env, isProduction);
  const rooms = await roomsFor(env, token, isProduction);

  return Response.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      /** What he is called in that room. A man can go by different names in
       * two different circles, and this is the one place both are on screen. */
      displayName: r.display_name,
      current: session?.group.id === r.id,
    })),
  });
}

/** POST /api/rooms/switch — { groupId, deviceToken } */
export async function switchRoom(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  let body: { groupId?: unknown; deviceToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const groupId = typeof body.groupId === 'string' ? body.groupId : '';
  const token = typeof body.deviceToken === 'string' ? body.deviceToken : '';

  const rooms = await roomsFor(env, token, isProduction);
  const to = rooms.find((r) => r.id === groupId);
  // Not a member, or not this device: the same answer either way, and no hint
  // about whether the room exists.
  if (!to) return Response.json({ error: 'not_yours' }, { status: 403 });

  const cookie = await signIdentity(env, { groupId: to.id, memberId: to.member_id }, isProduction);
  // He is in this room now, so it sorts to the top of his list next time.
  await env.DB.prepare('UPDATE members SET last_seen = ? WHERE id = ?')
    .bind(Date.now(), to.member_id)
    .run();

  return Response.json(
    { id: to.id, name: to.name, slug: to.slug },
    { headers: { 'Set-Cookie': identityCookie(cookie, isProduction) } },
  );
}
