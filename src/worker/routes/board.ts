import { parseWeek } from '../../shared/week';
import {
  buildBoard,
  currentWeek,
  MAX_COMMITMENT_LENGTH,
  MAX_NOTE_LENGTH,
  type Outcome,
} from '../board';
import type { Env } from '../env';
import type { Said } from '../../shared/said';
import { newId } from '../identity';
import { IDENTITY_HEADERS } from '../RoomDO';
import { currentSession, type Session } from './auth';

async function requireSession(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Session | Response> {
  const session = await currentSession(request, env, isProduction);
  return session ?? Response.json({ error: 'unauthorized' }, { status: 401 });
}

/**
 * Tells the room. The board is where this lives, but a line in the room is
 * what makes anyone look at the board — and being seen is the point.
 */
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

/** GET /api/board — the last six weeks, everyone's. */
export async function getBoard(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await requireSession(request, env, isProduction);
  if (session instanceof Response) return session;
  return Response.json({
    ...(await buildBoard(env, session.group.id, session.member.id)),
    you: session.member.id,
  });
}

/**
 * PUT /api/check-in — { rating, note }
 *
 * One per dad per week, replaced if he changes his mind. Group-visible.
 */
export async function putCheckIn(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await requireSession(request, env, isProduction);
  if (session instanceof Response) return session;

  let payload: { rating?: unknown; note?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const rating = Number(payload.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return Response.json({ error: 'bad_rating' }, { status: 400 });
  }
  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  if ([...note].length > MAX_NOTE_LENGTH) {
    return Response.json({ error: 'note_too_long' }, { status: 400 });
  }

  const week = await currentWeek(env, session.group.id);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO check_ins (id, group_id, member_id, week, rating, note, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(group_id, member_id, week) DO UPDATE
       SET rating = ?5, note = ?6, updated_at = ?7`,
  )
    .bind(newId('chk'), session.group.id, session.member.id, week, rating, note, now)
    .run();

  await announce(env, session, {
    k: 'check_in',
    name: session.member.displayName,
    rating,
    note,
  });

  return Response.json({ week, rating, note });
}

/**
 * PUT /api/commitment — { body }
 *
 * One concrete thing to try this week. One per dad per week; setting it again
 * replaces it, which is honest — changing your mind on Tuesday is fine, and
 * the group sees the current version either way.
 */
export async function putCommitment(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await requireSession(request, env, isProduction);
  if (session instanceof Response) return session;

  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return Response.json({ error: 'empty' }, { status: 400 });
  if ([...body].length > MAX_COMMITMENT_LENGTH) {
    return Response.json({ error: 'too_long' }, { status: 400 });
  }

  const week = await currentWeek(env, session.group.id);
  await env.DB.prepare(
    `INSERT INTO commitments (id, group_id, member_id, week, body, outcome, reflection, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', '', ?6)
     ON CONFLICT(group_id, member_id, week) DO UPDATE
       SET body = ?5, outcome = 'pending', reflection = '', reflected_at = NULL`,
  )
    .bind(newId('cmt'), session.group.id, session.member.id, week, body, Date.now())
    .run();

  await announce(env, session, { k: 'commitment', name: session.member.displayName, body });
  return Response.json({ week, body, outcome: 'pending' });
}

/**
 * PUT /api/commitment-outcome — { week, outcome, reflection }
 *
 * How it actually went. Usually answered about last week, at the top of the
 * new one.
 */
export async function putCommitmentOutcome(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await requireSession(request, env, isProduction);
  if (session instanceof Response) return session;

  let payload: { week?: unknown; outcome?: unknown; reflection?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const week = typeof payload.week === 'string' ? payload.week : '';
  if (!parseWeek(week)) return Response.json({ error: 'bad_week' }, { status: 400 });

  const outcome = payload.outcome as Outcome;
  if (outcome !== 'done' && outcome !== 'missed') {
    return Response.json({ error: 'bad_outcome' }, { status: 400 });
  }
  const reflection = typeof payload.reflection === 'string' ? payload.reflection.trim() : '';
  if ([...reflection].length > MAX_NOTE_LENGTH) {
    return Response.json({ error: 'note_too_long' }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    'SELECT body FROM commitments WHERE group_id = ? AND member_id = ? AND week = ?',
  )
    .bind(session.group.id, session.member.id, week)
    .first<{ body: string }>();
  if (!existing) return Response.json({ error: 'no_commitment' }, { status: 404 });

  await env.DB.prepare(
    `UPDATE commitments SET outcome = ?, reflection = ?, reflected_at = ?
      WHERE group_id = ? AND member_id = ? AND week = ?`,
  )
    .bind(outcome, reflection, Date.now(), session.group.id, session.member.id, week)
    .run();

  await announce(env, session, {
    k: 'outcome',
    name: session.member.displayName,
    body: existing.body,
    note: reflection,
    done: outcome === 'done',
  });

  return Response.json({ week, outcome, reflection });
}
