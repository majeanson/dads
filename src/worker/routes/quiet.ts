import { isClock, isSnooze, isZone, SNOOZES } from '../../shared/quiet';
import type { Env } from '../env';
import { currentSession } from './auth';

/**
 * GET /api/quiet and PUT /api/quiet — when this dad does not want a push.
 *
 * His, across every phone he has (it lives on `members`, like Google Chat's
 * snooze, which follows the man and not the device). Nothing here says
 * anything in the room and nobody else can read it: a dad who has gone quiet
 * is not news, and "Sam has muted us" is exactly what this must not become.
 *
 * Two independent things, and a PUT changes only what it names:
 *   { window: { from: "22:00", to: "07:00", tz: "America/Montreal" } | null }
 *   { snooze: "1h" | "8h" | "24h" | null }
 * A pause is counted from now ON THE SERVER, never from the client's clock.
 */
export interface QuietState {
  from: string | null;
  to: string | null;
  tz: string | null;
  snoozedUntil: number | null;
}

async function read(env: Env, memberId: string, now: number): Promise<QuietState> {
  const row = await env.DB.prepare(
    `SELECT quiet_from, quiet_to, quiet_tz, snoozed_until FROM members
      WHERE id = ? AND gone_at IS NULL`,
  )
    .bind(memberId)
    .first<{
      quiet_from: string | null;
      quiet_to: string | null;
      quiet_tz: string | null;
      snoozed_until: number | null;
    }>();
  return {
    from: row?.quiet_from ?? null,
    to: row?.quiet_to ?? null,
    tz: row?.quiet_tz ?? null,
    // An ended pause is not reported: the client shows what is in force.
    snoozedUntil: row?.snoozed_until != null && row.snoozed_until > now ? row.snoozed_until : null,
  };
}

export async function getQuiet(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await read(env, session.member.id, Date.now()), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function putQuiet(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: { window?: unknown; snooze?: unknown };
  try {
    body = (await request.json()) as { window?: unknown; snooze?: unknown };
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const now = Date.now();
  const memberId = session.member.id;
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if ('window' in body) {
    const w = body.window as { from?: unknown; to?: unknown; tz?: unknown } | null;
    if (w === null) {
      sets.push('quiet_from = NULL', 'quiet_to = NULL', 'quiet_tz = NULL');
    } else if (
      typeof w === 'object' &&
      isClock(w.from) &&
      isClock(w.to) &&
      isZone(w.tz) &&
      w.from !== w.to
    ) {
      sets.push('quiet_from = ?', 'quiet_to = ?', 'quiet_tz = ?');
      values.push(w.from, w.to, w.tz);
    } else {
      return Response.json({ error: 'bad_window' }, { status: 400 });
    }
  }

  if ('snooze' in body) {
    if (body.snooze === null) {
      sets.push('snoozed_until = NULL');
    } else if (isSnooze(body.snooze)) {
      sets.push('snoozed_until = ?');
      values.push(now + SNOOZES[body.snooze]);
    } else {
      return Response.json({ error: 'bad_snooze' }, { status: 400 });
    }
  }

  if (sets.length === 0) return Response.json({ error: 'bad_request' }, { status: 400 });

  await env.DB.prepare(`UPDATE members SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .bind(...values, memberId, session.group.id)
    .run();

  return Response.json(await read(env, memberId, now));
}
