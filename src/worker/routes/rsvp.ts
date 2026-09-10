import { currentWindow, nextStart, type DadNight } from '../../shared/dadNight';
import type { Said } from '../../shared/said';
import type { Env } from '../env';
import { newId } from '../identity';
import { IDENTITY_HEADERS } from '../RoomDO';
import { currentSession, type Session } from './auth';

/** Long enough for the thought, short enough that it is not the conversation
 * itself — the conversation is the point of turning up. */
export const MAX_ITEM_LENGTH = 200;

/** Enough for an evening. Past this the list stops being a list. */
const MAX_ITEMS = 30;

export interface Rsvp {
  memberId: string;
  name: string;
  coming: boolean;
}

export interface NightItem {
  id: string;
  memberId: string;
  name: string;
  body: string;
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

/** Everything the week has put up for one evening, oldest first. */
export async function itemsFor(
  env: Env,
  groupId: string,
  occurrence: number,
): Promise<NightItem[]> {
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.member_id, i.body, m.display_name
       FROM night_items i JOIN members m ON m.id = i.member_id
      WHERE i.group_id = ? AND i.occurrence = ?
      ORDER BY i.created_at`,
  )
    .bind(groupId, occurrence)
    .all<{ id: string; member_id: string; body: string; display_name: string }>();

  return results.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    name: r.display_name,
    body: r.body,
  }));
}

/**
 * POST /api/night-item — { body }
 *
 * Announced by name, with the thing itself. This is the one line in the room
 * that carries its own detail rather than pointing at a sheet: half the value
 * of a man writing it down is another man reading it and thinking of his own.
 */
export async function addNightItem(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return Response.json({ error: 'empty' }, { status: 400 });
  if ([...body].length > MAX_ITEM_LENGTH) {
    return Response.json({ error: 'too_long' }, { status: 400 });
  }

  const occurrence = occurrenceOf(session.group.dadNight);
  if (occurrence === null) return Response.json({ error: 'no_night' }, { status: 409 });

  const existing = await itemsFor(env, session.group.id, occurrence);
  if (existing.length >= MAX_ITEMS) return Response.json({ error: 'full' }, { status: 409 });

  await env.DB.prepare(
    `INSERT INTO night_items (id, group_id, member_id, occurrence, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('item'), session.group.id, session.member.id, occurrence, body, Date.now())
    .run();

  await announce(env, session, { k: 'item_added', name: session.member.displayName, body });

  return Response.json({
    occurrence,
    answers: await answersFor(env, session, occurrence),
    items: await itemsFor(env, session.group.id, occurrence),
  });
}

/**
 * DELETE /api/night-item?id= — taking your own back.
 *
 * Keyed on the member as well as the id, so a dad can only remove what he put
 * up. Nothing is said in the room: a man changing his mind about a question he
 * wanted to ask does not owe anybody an announcement.
 */
export async function removeNightItem(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  await env.DB.prepare('DELETE FROM night_items WHERE id = ? AND group_id = ? AND member_id = ?')
    .bind(url.searchParams.get('id') ?? '', session.group.id, session.member.id)
    .run();

  const occurrence = occurrenceOf(session.group.dadNight);
  if (occurrence === null) return Response.json({ occurrence: null, answers: [], items: [] });
  return Response.json({
    occurrence,
    answers: await answersFor(env, session, occurrence),
    items: await itemsFor(env, session.group.id, occurrence),
  });
}

/** The room's own voice, from a route rather than from a socket. */
async function announce(env: Env, session: Session, said: Said): Promise<void> {
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

/** GET /api/night — the evening, who is coming, and what is up for it. */
export async function getRsvps(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const occurrence = occurrenceOf(session.group.dadNight);
  if (occurrence === null) return Response.json({ occurrence: null, answers: [], items: [] });
  return Response.json({
    occurrence,
    answers: await answersFor(env, session, occurrence),
    items: await itemsFor(env, session.group.id, occurrence),
  });
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
    await announce(env, session, { k: 'rsvp', name: session.member.displayName, coming });
  }

  return Response.json({
    occurrence,
    answers: await answersFor(env, session, occurrence),
    items: await itemsFor(env, session.group.id, occurrence),
  });
}
