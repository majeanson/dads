import { currentWindow, nextStart, type DadNight } from '../../shared/dadNight';
import type { Said } from '../../shared/said';
import type { Env } from '../env';
import { IDENTITY_HEADERS } from '../RoomDO';
import { currentSession, type Session } from './auth';

export interface Rsvp {
  memberId: string;
  name: string;
  coming: boolean;
}

/**
 * Which evening an answer is about, decided here and never by the client.
 *
 * Inside a window it is that window — a dad saying "I'm in" at ten past nine
 * means tonight, not next week. Otherwise it is the next start. Two phones
 * with two clocks cannot disagree about this, because neither of them is asked.
 */
export function occurrenceOf(night: DadNight | null, now = Date.now()): number | null {
  if (night === null) return null;
  const window = currentWindow(night, now);
  if (window) return window.start;
  return nextStart(night, now);
}

async function answersFor(env: Env, session: Session, occurrence: number): Promise<Rsvp[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.member_id, r.answer, m.display_name
       FROM rsvps r JOIN members m ON m.id = r.member_id
      WHERE r.group_id = ? AND r.occurrence = ?
      ORDER BY r.updated_at`,
  )
    .bind(session.group.id, occurrence)
    .all<{ member_id: string; answer: string; display_name: string }>();

  return results.map((r) => ({
    memberId: r.member_id,
    name: r.display_name,
    coming: r.answer === 'in',
  }));
}

/** GET /api/rsvp — the evening being answered, and who has answered it. */
export async function getRsvps(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const occurrence = occurrenceOf(session.group.dadNight);
  if (occurrence === null) return Response.json({ occurrence: null, answers: [] });
  return Response.json({ occurrence, answers: await answersFor(env, session, occurrence) });
}

/**
 * PUT /api/rsvp — { coming: boolean }
 *
 * Announced in the room by name, like the night itself and like a check-in:
 * saying you are coming where the others can see it is the entire mechanism.
 * Changing your mind rewrites the row and says so again.
 */
export async function putRsvp(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: { coming?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof body.coming !== 'boolean') {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const occurrence = occurrenceOf(session.group.dadNight);
  if (occurrence === null) return Response.json({ error: 'no_night' }, { status: 409 });

  const coming = body.coming;
  const before = await env.DB.prepare(
    'SELECT answer FROM rsvps WHERE group_id = ? AND member_id = ? AND occurrence = ?',
  )
    .bind(session.group.id, session.member.id, occurrence)
    .first<{ answer: string }>();

  await env.DB.prepare(
    `INSERT INTO rsvps (group_id, member_id, occurrence, answer, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(group_id, member_id, occurrence)
       DO UPDATE SET answer = ?4, updated_at = ?5`,
  )
    .bind(session.group.id, session.member.id, occurrence, coming ? 'in' : 'out', Date.now())
    .run();

  // The same answer twice is a dad pressing the button he already pressed;
  // the room does not need to hear about it.
  if (before?.answer !== (coming ? 'in' : 'out')) {
    const said: Said = { k: 'rsvp', name: session.member.displayName, coming };
    const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
    await stub.fetch('https://room/announce', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [IDENTITY_HEADERS.groupId]: session.group.id,
      },
      body: JSON.stringify({ name: session.member.displayName, said }),
    });
  }

  return Response.json({ occurrence, answers: await answersFor(env, session, occurrence) });
}
