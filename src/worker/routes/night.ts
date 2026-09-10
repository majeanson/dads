import { isValidNight, type DadNight } from '../../shared/dadNight';
import type { Env } from '../env';
import { IDENTITY_HEADERS } from '../RoomDO';
import { currentSession } from './auth';

/**
 * PUT /api/night — { night: DadNight | null }
 *
 * Any dad can set it. There is no admin role in a group of five friends who
 * already know each other, and the change is announced in the room by name,
 * which is the only accountability this needs.
 */
export async function setNight(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: { night?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  let night: DadNight | null = null;
  if (body.night !== null && body.night !== undefined) {
    const candidate = body.night as Partial<DadNight>;
    night = {
      weekday: Number(candidate.weekday),
      time: String(candidate.time ?? ''),
      // Falling back to the group's stored zone means a client that does not
      // send one cannot silently move the night to UTC.
      tz: String(candidate.tz ?? session.group.dadNight?.tz ?? 'America/Montreal'),
    };
    if (!isValidNight(night)) return Response.json({ error: 'bad_night' }, { status: 400 });
  }

  await env.DB.prepare(
    `UPDATE groups
        SET dad_night_weekday = ?, dad_night_time = ?, dad_night_tz = COALESCE(?, dad_night_tz)
      WHERE id = ?`,
  )
    .bind(night?.weekday ?? null, night?.time ?? null, night?.tz ?? null, session.group.id)
    .run();

  // Tell the room: it re-arms its timers, announces the change and pushes the
  // new schedule to anyone already connected.
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/night', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify({ night, byName: session.member.displayName }),
  });

  return Response.json({ night });
}
