import type { Env } from './env';
import { currentSession } from './routes/auth';

/**
 * What went wrong, written down by the app itself.
 *
 * A room of three dads on phones does not file bug reports: a photo that
 * never sent is a photo nobody mentions. Workers Logs keep what the Worker
 * threw for a few days, and nobody reads them; nothing at all kept what a
 * PHONE saw go wrong. Both land in D1 `oops` now, and `npm run oops` reads it.
 */

export type OopsSide = 'worker' | 'room' | 'web';

export interface Oops {
  side: OopsSide;
  /** Where, as a short code: `api POST /api/media`, `room.alarm`, `web.outbox`. */
  what: string;
  message: string;
  detail?: string | null;
  groupId?: string | null;
  memberId?: string | null;
  build?: string | null;
  agent?: string | null;
}

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Per dad per hour, and for everybody not yet in a room together: a phone
 * stuck in a loop should leave one screenful, not fill the table. */
const PER_HOUR = 30;

export const OOPS_LIMITS = { what: 80, message: 500, detail: 2000, build: 80, agent: 200 };

const cut = (s: string | null | undefined, n: number): string | null =>
  s === null || s === undefined ? null : s.slice(0, n);

/** The message and stack of anything thrown, whatever it was. */
export function described(err: unknown): { message: string; detail: string | null } {
  if (err instanceof Error)
    return { message: `${err.name}: ${err.message}`, detail: err.stack ?? null };
  return { message: String(err), detail: null };
}

/**
 * Writes one report. Never throws: the thing being reported has already gone
 * wrong, and the report going wrong too must not change what the dad sees.
 * Also said to the console, so `wrangler tail` and Workers Logs have it.
 */
export async function recordOops(env: Env, oops: Oops, now = Date.now()): Promise<void> {
  if (oops.side !== 'web') console.error(`oops ${oops.what}: ${oops.message}`, oops.detail ?? '');
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO oops (at, side, what, message, detail, group_id, member_id, build, agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        now,
        oops.side,
        cut(oops.what, OOPS_LIMITS.what),
        cut(oops.message, OOPS_LIMITS.message),
        cut(oops.detail, OOPS_LIMITS.detail),
        oops.groupId ?? null,
        oops.memberId ?? null,
        cut(oops.build, OOPS_LIMITS.build),
        cut(oops.agent, OOPS_LIMITS.agent),
      ),
      env.DB.prepare('DELETE FROM oops WHERE at < ?').bind(now - KEEP_MS),
    ]);
  } catch (err) {
    console.error('oops: could not record', err);
  }
}

/**
 * POST /api/oops — a phone saying what went wrong on it.
 *
 * Open to the door as well as the room: a join that fails is exactly the
 * report worth having, and it comes from a phone with no session yet. Another
 * site's page is already refused by `crossOrigin`. What stops a script filling
 * the table is the hourly cap — per dad, and one shared by everybody without a
 * session — and anything over it is dropped quietly: the phone has no use for
 * knowing.
 */
export async function postOops(
  request: Request,
  env: Env,
  isProduction: boolean,
  now = Date.now(),
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
  const what = text(body.what, OOPS_LIMITS.what);
  const message = text(body.message, OOPS_LIMITS.message);
  if (!what || !/^[a-z][a-z0-9_.:-]*$/.test(what) || !message) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const session = await currentSession(request, env, isProduction);
  const memberId = session?.member.id ?? null;
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM oops
     WHERE side = 'web' AND member_id IS ? AND at > ?`,
  )
    .bind(memberId, now - HOUR_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= PER_HOUR) return new Response(null, { status: 204 });

  await recordOops(
    env,
    {
      side: 'web',
      what,
      message,
      detail: typeof body.detail === 'string' ? body.detail : null,
      build: typeof body.build === 'string' ? body.build : null,
      agent: request.headers.get('User-Agent'),
      groupId: session?.group.id ?? null,
      memberId,
    },
    now,
  );
  return new Response(null, { status: 204 });
}
