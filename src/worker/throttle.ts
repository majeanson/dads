import { hmac } from './crypto';
import type { Env } from './env';
import { sessionSecret } from './env';

/** A fixed 10-minute window. Long enough to be a real cost, short enough that
 * a locked-out dad can go make a coffee and try again. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;

export interface ThrottleState {
  allowed: boolean;
  retryAfterSeconds: number;
}

async function bucketFor(
  env: Env,
  request: Request,
  isProduction: boolean,
  kind = 'join',
): Promise<string> {
  // Behind Cloudflare, CF-Connecting-IP is set by the edge and cannot be
  // spoofed by the client. Locally it is absent, so everything shares one
  // bucket — which is correct: local is a single developer.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  return hmac(sessionSecret(env, isProduction), `${kind}:${ip}`);
}

/**
 * How many rooms one address may open, and over how long.
 *
 * Opening a room is a door anybody can walk up to now, and what it costs the
 * app is a row, a slug and a name at the top of somebody's screen for ever.
 * Three a day is more than anyone doing it for real will ever want and few
 * enough that a bored script is not worth writing. Counted where wrong codes
 * are counted — same table, its own bucket, so the two cannot lock each
 * other out.
 */
const ROOMS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function checkRoomLimit(
  env: Env,
  request: Request,
  isProduction: boolean,
  now = Date.now(),
): Promise<ThrottleState> {
  const bucket = await bucketFor(env, request, isProduction, 'new');
  const row = await env.DB.prepare(
    'SELECT failures, window_start FROM join_attempts WHERE bucket = ?',
  )
    .bind(bucket)
    .first<{ failures: number; window_start: number }>();

  if (!row || now - row.window_start >= DAY_MS) return { allowed: true, retryAfterSeconds: 0 };
  if (row.failures < ROOMS_PER_DAY) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((row.window_start + DAY_MS - now) / 1000),
  };
}

/** A room that really got made. Unlike a wrong code, success is what counts
 * here — the cost is the room, not the guess. */
export async function recordRoomMade(
  env: Env,
  request: Request,
  isProduction: boolean,
  now = Date.now(),
): Promise<void> {
  const bucket = await bucketFor(env, request, isProduction, 'new');
  await env.DB.prepare(
    `INSERT INTO join_attempts (bucket, failures, window_start)
     VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET
       failures = CASE WHEN ?2 - join_attempts.window_start >= ?3
                       THEN 1 ELSE join_attempts.failures + 1 END,
       window_start = CASE WHEN ?2 - join_attempts.window_start >= ?3
                          THEN ?2 ELSE join_attempts.window_start END`,
  )
    .bind(bucket, now, DAY_MS)
    .run();
}

export async function checkJoinThrottle(
  env: Env,
  request: Request,
  isProduction: boolean,
  now = Date.now(),
): Promise<ThrottleState> {
  const bucket = await bucketFor(env, request, isProduction);
  const row = await env.DB.prepare(
    'SELECT failures, window_start FROM join_attempts WHERE bucket = ?',
  )
    .bind(bucket)
    .first<{ failures: number; window_start: number }>();

  if (!row || now - row.window_start >= WINDOW_MS) return { allowed: true, retryAfterSeconds: 0 };
  if (row.failures < MAX_FAILURES) return { allowed: true, retryAfterSeconds: 0 };

  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((row.window_start + WINDOW_MS - now) / 1000),
  };
}

export async function recordJoinFailure(
  env: Env,
  request: Request,
  isProduction: boolean,
  now = Date.now(),
): Promise<void> {
  const bucket = await bucketFor(env, request, isProduction);
  // One statement, so two simultaneous wrong guesses cannot both read 4 and
  // both write 5. The window resets in the same statement once it has expired.
  await env.DB.prepare(
    `INSERT INTO join_attempts (bucket, failures, window_start)
     VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET
       failures = CASE WHEN ?2 - join_attempts.window_start >= ?3
                       THEN 1 ELSE join_attempts.failures + 1 END,
       window_start = CASE WHEN ?2 - join_attempts.window_start >= ?3
                          THEN ?2 ELSE join_attempts.window_start END`,
  )
    .bind(bucket, now, WINDOW_MS)
    .run();
}

/** A dad who got in is not a suspect. */
export async function clearJoinFailures(
  env: Env,
  request: Request,
  isProduction: boolean,
): Promise<void> {
  const bucket = await bucketFor(env, request, isProduction);
  await env.DB.prepare('DELETE FROM join_attempts WHERE bucket = ?').bind(bucket).run();
}
