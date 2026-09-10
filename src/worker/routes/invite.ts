import { hashInviteToken, randomToken } from '../crypto';
import type { Env } from '../env';
import { sessionSecret } from '../env';
import { newId } from '../identity';
import { currentSession } from './auth';

/**
 * A week. Long enough that a dad can send it on Sunday and his friend can act
 * on it the following Saturday; short enough that a link forwarded into a
 * group chat two years ago does not still open the door.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /api/invite — mint a link.
 *
 * Any dad, like the night and the room switches: there is no admin in a room
 * of five friends. The token is returned exactly once, in this response — only
 * its HMAC is kept — so a dad who loses the link mints another rather than
 * asking us to remember it for him.
 */
export async function createInvite(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const now = Date.now();
  const token = randomToken();
  const hash = await hashInviteToken(sessionSecret(env, isProduction), token);

  // Yesterday's links are dead weight and a wider surface than they are worth.
  await env.DB.prepare('DELETE FROM invites WHERE group_id = ? AND expires_at <= ?')
    .bind(session.group.id, now)
    .run();

  await env.DB.prepare(
    `INSERT INTO invites (id, group_id, token_hash, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('inv'), session.group.id, hash, session.member.id, now, now + INVITE_TTL_MS)
    .run();

  return Response.json({ token, expiresAt: now + INVITE_TTL_MS });
}

/**
 * The group a live invite token opens, or null.
 *
 * One indexed lookup on the hash, so an expired or invented token costs the
 * same as a real one and there is nothing to time.
 */
export async function groupIdForInvite(
  env: Env,
  token: string,
  isProduction: boolean,
  now = Date.now(),
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return null;
  const hash = await hashInviteToken(sessionSecret(env, isProduction), token);
  const row = await env.DB.prepare(
    'SELECT group_id FROM invites WHERE token_hash = ? AND expires_at > ?',
  )
    .bind(hash, now)
    .first<{ group_id: string }>();
  return row?.group_id ?? null;
}
