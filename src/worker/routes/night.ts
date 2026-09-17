import { isValidNight, weekdayOf, type DadNight } from '../../shared/dadNight';
import type { Env } from '../env';
import { IDENTITY_HEADERS } from '../RoomDO';
import { currentSession, type Session } from './auth';

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
  /**
   * Null means "leave the group's zone alone", and that is the normal case.
   *
   * dad_night_tz is not only the night's clock — board.ts derives the ISO week
   * from it and prompts.ts derives the daily rollover — so a dad setting a
   * night while travelling must not be able to move the group's whole
   * calendar. The client sends a zone only when it already knows the group's.
   */
  let tz: string | null = null;
  if (body.night !== null && body.night !== undefined) {
    const candidate = body.night as Partial<DadNight>;
    if (typeof candidate.tz === 'string' && candidate.tz !== '') tz = candidate.tz;

    /**
     * A date means it happens once; no date means every week.
     *
     * The weekday is DERIVED from the date rather than believed, so the two
     * halves of "Thursday the 24th" can never disagree — a client that sent a
     * stale weekday beside a fresh date would otherwise arm the room for the
     * wrong evening and nothing would ever notice.
     */
    const date =
      typeof candidate.date === 'string' && candidate.date !== '' ? candidate.date : null;
    const weekday = date !== null ? weekdayOf(date) : Number(candidate.weekday);
    if (weekday === null) return Response.json({ error: 'bad_night' }, { status: 400 });

    night = {
      weekday,
      time: String(candidate.time ?? ''),
      // Only for validation: what is actually written is COALESCE'd below, so
      // an unchanged zone stays exactly as the group has it.
      tz: tz ?? session.group.dadNight?.tz ?? 'America/Montreal',
      ...(date !== null ? { date } : {}),
    };
    if (!isValidNight(night)) return Response.json({ error: 'bad_night' }, { status: 400 });
  }

  return Response.json({ night: await writeNight(env, session, night, tz) });
}

/**
 * Write the group's night and tell the room about it.
 *
 * Shared with the calendar that picks the next one: locking a date in IS
 * setting the night, and two routes writing the same four columns in two
 * slightly different ways is how they come to disagree.
 *
 * `tz` is the zone the caller is allowed to move the group to, and is almost
 * always null — see the comment on the request body above.
 */
export async function writeNight(
  env: Env,
  session: Session,
  night: DadNight | null,
  tz: string | null = null,
): Promise<DadNight | null> {
  await env.DB.prepare(
    `UPDATE groups
        SET dad_night_weekday = ?, dad_night_time = ?, dad_night_date = ?,
            dad_night_tz = COALESCE(?, dad_night_tz)
      WHERE id = ?`,
  )
    .bind(night?.weekday ?? null, night?.time ?? null, night?.date ?? null, tz, session.group.id)
    .run();

  // What the room is told must be what the group actually has, not what the
  // request happened to carry.
  let settled = night;
  if (settled !== null) {
    const stored = await env.DB.prepare('SELECT dad_night_tz FROM groups WHERE id = ?')
      .bind(session.group.id)
      .first<{ dad_night_tz: string }>();
    settled = { ...settled, tz: stored?.dad_night_tz ?? settled.tz };
  }

  // Tell the room: it re-arms its timers, announces the change and pushes the
  // new schedule to anyone already connected.
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/night', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [IDENTITY_HEADERS.groupId]: session.group.id,
    },
    body: JSON.stringify({ night: settled, byName: session.member.displayName }),
  });

  return settled;
}
