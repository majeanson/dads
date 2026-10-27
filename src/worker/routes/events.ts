import { civilDayIn } from '../../shared/dadNight';
import {
  EVENT_WINDOW_MS,
  MAX_UPCOMING_EVENTS,
  parseEventInput,
  remindAt,
  type EventAnswer,
  type EventsState,
  type GroupEvent,
} from '../../shared/events';
import type { Env } from '../env';
import { newId } from '../identity';
import { IDENTITY_HEADERS } from '../RoomDO';
import { currentSession, type Session } from './auth';
import { icsText } from './calendar';
import { parseAnswer } from './rsvp';

const DEFAULT_TZ = 'America/Montreal';

interface EventRow {
  id: string;
  member_id: string;
  title: string;
  place: string;
  day: string;
  time: string;
  tz: string;
  starts_at: number;
  display_name: string;
}

const groupTz = (session: Session) => session.group.dadNight?.tz ?? DEFAULT_TZ;

/** Upcoming means not over: an event stays on the list through its window, so
 * a man opening the app at the barbecue still finds it. */
async function eventsFor(env: Env, session: Session, now: number): Promise<GroupEvent[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.member_id, e.title, e.place, e.day, e.time, e.tz, e.starts_at, m.display_name
       FROM events e JOIN members m ON m.id = e.member_id
      WHERE e.group_id = ? AND e.starts_at >= ?
      ORDER BY e.starts_at, e.created_at`,
  )
    .bind(session.group.id, now - EVENT_WINDOW_MS)
    .all<EventRow>();

  const answers = await env.DB.prepare(
    `SELECT r.event_id, r.member_id, r.answer, m.display_name
       FROM event_rsvps r
       JOIN members m ON m.id = r.member_id
       JOIN events e ON e.id = r.event_id
      WHERE r.group_id = ? AND e.starts_at >= ? AND m.gone_at IS NULL
      ORDER BY r.updated_at`,
  )
    .bind(session.group.id, now - EVENT_WINDOW_MS)
    .all<{ event_id: string; member_id: string; answer: string; display_name: string }>();

  const byEvent = new Map<string, EventAnswer[]>();
  for (const r of answers.results) {
    const list = byEvent.get(r.event_id) ?? [];
    list.push({
      memberId: r.member_id,
      name: r.display_name,
      answer: parseAnswer(r.answer) ?? 'out',
    });
    byEvent.set(r.event_id, list);
  }

  return results.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    name: r.display_name,
    title: r.title,
    place: r.place,
    day: r.day,
    time: r.time,
    tz: r.tz,
    startsAt: r.starts_at,
    answers: byEvent.get(r.id) ?? [],
  }));
}

async function state(env: Env, session: Session): Promise<EventsState> {
  const now = Date.now();
  return {
    today: civilDayIn(now, groupTz(session)),
    events: await eventsFor(env, session, now),
  };
}

/**
 * Tell the room something changed. The object re-arms its alarm for the next
 * event push, and open screens hear a `stir` — a nudge to look again, never
 * a line in the conversation.
 */
async function changed(env: Env, session: Session): Promise<void> {
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  await stub.fetch('https://room/events', {
    method: 'POST',
    headers: { [IDENTITY_HEADERS.groupId]: session.group.id },
  });
}

/** GET /api/events — what is coming up. No stir on a read. */
export async function getEvents(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await state(env, session));
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** An event made less than a day out has no "tomorrow" left to announce. */
const remindedAtBirth = (startsAt: number, now: number): number | null =>
  remindAt(startsAt) <= now ? now : null;

/** POST /api/events — { title, place?, day, time } */
export async function postEvent(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const now = Date.now();
  const tz = groupTz(session);
  const parsed = parseEventInput(await readBody(request), tz, now);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const count = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM events WHERE group_id = ? AND starts_at >= ?',
  )
    .bind(session.group.id, now)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_UPCOMING_EVENTS) {
    return Response.json({ error: 'full' }, { status: 409 });
  }

  const { value, startsAt } = parsed;
  const id = newId('event');
  await env.DB.prepare(
    `INSERT INTO events
       (id, group_id, member_id, title, place, day, time, tz, starts_at, reminded_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      session.group.id,
      session.member.id,
      value.title,
      value.place,
      value.day,
      value.time,
      tz,
      startsAt,
      remindedAtBirth(startsAt, now),
      now,
    )
    .run();

  await changed(env, session);
  return Response.json({ id, ...(await state(env, session)) });
}

/**
 * PUT /api/events — { id, title, place?, day, time }
 *
 * The author's. Moving it resets the two pushes, because they were about a
 * different evening.
 */
export async function putEvent(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const raw = await readBody(request);
  const id =
    typeof (raw as { id?: unknown } | null)?.id === 'string' ? (raw as { id: string }).id : '';

  const now = Date.now();
  const existing = await env.DB.prepare(
    'SELECT member_id, tz FROM events WHERE id = ? AND group_id = ?',
  )
    .bind(id, session.group.id)
    .first<{ member_id: string; tz: string }>();
  if (!existing) return Response.json({ error: 'not_found' }, { status: 404 });
  if (existing.member_id !== session.member.id) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  // The zone it was made in, not the group's today: moving the night's zone
  // must not quietly move an evening already in five calendars.
  const parsed = parseEventInput(raw, existing.tz, now);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const { value, startsAt } = parsed;
  await env.DB.prepare(
    `UPDATE events
        SET title = ?, place = ?, day = ?, time = ?, starts_at = ?,
            reminded_at = ?, started_at = NULL
      WHERE id = ? AND group_id = ? AND member_id = ?`,
  )
    .bind(
      value.title,
      value.place,
      value.day,
      value.time,
      startsAt,
      remindedAtBirth(startsAt, now),
      id,
      session.group.id,
      session.member.id,
    )
    .run();

  await changed(env, session);
  return Response.json(await state(env, session));
}

/** DELETE /api/events?id= — cancelling your own. His answers go with it. */
export async function deleteEvent(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  await env.DB.prepare('DELETE FROM events WHERE id = ? AND group_id = ? AND member_id = ?')
    .bind(url.searchParams.get('id') ?? '', session.group.id, session.member.id)
    .run();

  await changed(env, session);
  return Response.json(await state(env, session));
}

/** PUT /api/events/rsvp — { id, answer }. Rewrites his row. */
export async function putEventRsvp(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const raw = (await readBody(request)) as { id?: unknown; answer?: unknown } | null;
  const answer = parseAnswer(raw?.answer);
  if (typeof raw?.id !== 'string' || answer === null) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Scoped to the group: an id from another room is simply not found.
  const event = await env.DB.prepare('SELECT 1 AS ok FROM events WHERE id = ? AND group_id = ?')
    .bind(raw.id, session.group.id)
    .first();
  if (!event) return Response.json({ error: 'not_found' }, { status: 404 });

  await env.DB.prepare(
    `INSERT INTO event_rsvps (group_id, event_id, member_id, answer, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(event_id, member_id) DO UPDATE SET answer = ?4, updated_at = ?5`,
  )
    .bind(session.group.id, raw.id, session.member.id, answer, Date.now())
    .run();

  await changed(env, session);
  return Response.json(await state(env, session));
}

/** "20261110T190000" — the wall clock, which is what a TZID DTSTART means. */
function civilStamp(day: string, time: string): string {
  return `${day.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/** GET /api/event.ics?id= — one event, as a single appointment. */
export async function getEventIcs(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return new Response('unauthorized', { status: 401 });

  const row = await env.DB.prepare(
    'SELECT id, title, place, day, time, tz FROM events WHERE id = ? AND group_id = ?',
  )
    .bind(url.searchParams.get('id') ?? '', session.group.id)
    .first<{ id: string; title: string; place: string; day: string; time: string; tz: string }>();
  if (!row) return new Response('no event', { status: 404 });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//dads//event//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    // Its own id, so adding next month's never rewrites this one.
    `UID:event-${row.id}@dads`,
    `DTSTAMP:${stamp}Z`,
    `DTSTART;TZID=${row.tz}:${civilStamp(row.day, row.time)}`,
    `DURATION:PT${EVENT_WINDOW_MS / 3_600_000}H`,
    `SUMMARY:${icsText(row.title)}`,
    ...(row.place ? [`LOCATION:${icsText(row.place)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return new Response(`${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="event.ics"',
      'Cache-Control': 'no-store',
    },
  });
}
