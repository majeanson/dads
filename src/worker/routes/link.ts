import { hashDeviceToken, hashLinkToken, randomToken } from '../crypto';
import type { Env } from '../env';
import { sessionSecret } from '../env';
import { identityCookie, signIdentity } from '../identity';
import { checkJoinThrottle, recordJoinFailure } from '../throttle';
import { currentSession } from './auth';

/** Long enough to walk to the other phone; short enough that a link left on a
 * screen is dead by the time anybody finds it. */
export const LINK_TTL_MS = 10 * 60 * 1000;

/**
 * POST /api/link — mint a link that brings ANOTHER device in as this dad.
 *
 * Only a device that is already him can do it, which is the whole safety of
 * it: joining by name never reaches an existing dad. The token is returned
 * once and only its HMAC is kept.
 */
export async function createLink(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const now = Date.now();
  const token = randomToken();
  const hash = await hashLinkToken(sessionSecret(env, isProduction), token);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM device_links WHERE member_id = ? OR expires_at <= ?').bind(
      session.member.id,
      now,
    ),
    env.DB.prepare(
      'INSERT INTO device_links (token_hash, group_id, member_id, expires_at) VALUES (?, ?, ?, ?)',
    ).bind(hash, session.group.id, session.member.id, now + LINK_TTL_MS),
  ]);

  return Response.json({ token, expiresAt: now + LINK_TTL_MS });
}

/**
 * POST /api/link/claim — { token, deviceToken? }
 *
 * Spends the link and gives this device his identity: a cookie for him, and
 * the device token it should keep so it comes back as him when the cookie is
 * lost. A wrong or spent link counts against the same per-address bucket as a
 * wrong word, and fails into one message.
 */
export async function claimLink(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const throttle = await checkJoinThrottle(env, request, isProduction);
  if (!throttle.allowed) {
    return Response.json(
      { error: 'too_many_attempts', retryAfterSeconds: throttle.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } },
    );
  }

  let body: { token?: unknown; deviceToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const secret = sessionSecret(env, isProduction);
  const token = typeof body.token === 'string' ? body.token : '';
  const linkHash = /^[A-Za-z0-9_-]{32,}$/.test(token) ? await hashLinkToken(secret, token) : '';
  const row =
    linkHash === ''
      ? null
      : await env.DB.prepare(
          `SELECT l.group_id, l.member_id
             FROM device_links l JOIN members m ON m.id = l.member_id
            WHERE l.token_hash = ? AND l.expires_at > ? AND m.gone_at IS NULL`,
        )
          .bind(linkHash, Date.now())
          .first<{ group_id: string; member_id: string }>();

  // One use. The delete is the claim: if two phones race, one of them deletes
  // nothing and is told the link is spent.
  const spent = row
    ? await env.DB.prepare('DELETE FROM device_links WHERE token_hash = ?').bind(linkHash).run()
    : null;
  if (!row || spent === null || spent.meta.changes === 0) {
    await recordJoinFailure(env, request, isProduction);
    return Response.json({ error: 'bad_link' }, { status: 401 });
  }

  // The device's own token if it has a sound one that no other dad here uses;
  // otherwise a fresh one. Never a token that is somebody else's.
  const supplied = typeof body.deviceToken === 'string' ? body.deviceToken : '';
  let deviceToken = /^[A-Za-z0-9_-]{32,}$/.test(supplied) ? supplied : randomToken();
  let deviceHash = await hashDeviceToken(secret, deviceToken);
  const taken = await env.DB.prepare(
    `SELECT 1 AS one FROM members WHERE group_id = ?1 AND device_token_hash = ?2 AND id <> ?3
     UNION SELECT 1 FROM member_devices WHERE token_hash = ?2 AND member_id <> ?3`,
  )
    .bind(row.group_id, deviceHash, row.member_id)
    .first();
  if (taken) {
    deviceToken = randomToken();
    deviceHash = await hashDeviceToken(secret, deviceToken);
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO member_devices (token_hash, group_id, member_id, created_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(deviceHash, row.group_id, row.member_id, Date.now())
    .run();

  const cookie = await signIdentity(
    env,
    { groupId: row.group_id, memberId: row.member_id },
    isProduction,
  );
  return Response.json(
    { deviceToken },
    { headers: { 'Set-Cookie': identityCookie(cookie, isProduction) } },
  );
}
