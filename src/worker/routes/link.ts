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

  return adoptDevice(env, isProduction, row, body.deviceToken);
}

/**
 * Gives this device his identity: a cookie for him, and the device token it
 * should keep so it comes back as him when the cookie is lost.
 */
async function adoptDevice(
  env: Env,
  isProduction: boolean,
  row: { group_id: string; member_id: string },
  supplied: unknown,
): Promise<Response> {
  const secret = sessionSecret(env, isProduction);
  // The device's own token if it has a sound one that no other dad here uses;
  // otherwise a fresh one. Never a token that is somebody else's.
  const given = typeof supplied === 'string' ? supplied : '';
  let deviceToken = /^[A-Za-z0-9_-]{32,}$/.test(given) ? given : randomToken();
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

/** No 0/O or 1/I/L: it is read off one screen and typed into another. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const normalCode = (raw: unknown): string =>
  typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

/**
 * POST /api/pair — the new device asks. Returns the code to show and the
 * secret it polls with. Every ask counts against the join bucket: a code is
 * a thing somebody could be talked into typing, so they are not free.
 */
export async function startPair(
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
  await recordJoinFailure(env, request, isProduction);

  const secret = sessionSecret(env, isProduction);
  const code = newCode();
  const poll = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM device_pairs WHERE expires_at <= ?').bind(now),
    env.DB.prepare(
      'INSERT INTO device_pairs (code_hash, poll_hash, expires_at) VALUES (?, ?, ?)',
    ).bind(await hashLinkToken(secret, code), await hashLinkToken(secret, poll), now + LINK_TTL_MS),
  ]);
  return Response.json({ code, poll, expiresAt: now + LINK_TTL_MS });
}

/**
 * POST /api/pair/approve — { code } from a device that is already him: yes,
 * the device showing this code is me. A wrong code is a failed try.
 */
export async function approvePair(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const throttle = await checkJoinThrottle(env, request, isProduction);
  if (!throttle.allowed) {
    return Response.json(
      { error: 'too_many_attempts', retryAfterSeconds: throttle.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } },
    );
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const code = normalCode(body.code);
  const hash =
    code.length === CODE_LENGTH ? await hashLinkToken(sessionSecret(env, isProduction), code) : '';
  const done =
    hash === ''
      ? null
      : await env.DB.prepare(
          `UPDATE device_pairs SET group_id = ?, member_id = ?
            WHERE code_hash = ? AND member_id IS NULL AND expires_at > ?`,
        )
          .bind(session.group.id, session.member.id, hash, Date.now())
          .run();
  if (done === null || done.meta.changes === 0) {
    await recordJoinFailure(env, request, isProduction);
    return Response.json({ error: 'bad_code' }, { status: 404 });
  }
  return Response.json({ ok: true });
}

/**
 * POST /api/pair/poll — { poll, deviceToken? } from the new device. 202 until
 * a device has said yes; then it is spent exactly as a link is.
 */
export async function pollPair(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  let body: { poll?: unknown; deviceToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const poll = typeof body.poll === 'string' ? body.poll : '';
  if (!/^[A-Za-z0-9_-]{32,}$/.test(poll)) return Response.json({ error: 'gone' }, { status: 404 });
  const hash = await hashLinkToken(sessionSecret(env, isProduction), poll);
  const row = await env.DB.prepare(
    `SELECT p.group_id, p.member_id, p.expires_at
       FROM device_pairs p LEFT JOIN members m ON m.id = p.member_id
      WHERE p.poll_hash = ? AND (p.member_id IS NULL OR m.gone_at IS NULL)`,
  )
    .bind(hash)
    .first<{ group_id: string | null; member_id: string | null; expires_at: number }>();
  if (!row || row.expires_at <= Date.now()) {
    return Response.json({ error: 'gone' }, { status: 404 });
  }
  if (row.group_id === null || row.member_id === null) {
    return Response.json({ pending: true }, { status: 202 });
  }
  const spent = await env.DB.prepare('DELETE FROM device_pairs WHERE poll_hash = ?')
    .bind(hash)
    .run();
  if (spent.meta.changes === 0) return Response.json({ error: 'gone' }, { status: 404 });
  return adoptDevice(
    env,
    isProduction,
    { group_id: row.group_id, member_id: row.member_id },
    body.deviceToken,
  );
}
