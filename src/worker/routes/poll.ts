import { civilDayIn, stillToCome, weekdayOf, type DadNight } from '../../shared/dadNight';
import type { Env } from '../env';
import { IDENTITY_HEADERS } from '../RoomDO';
import { currentSession, type Session } from './auth';
import { writeNight } from './night';
import { parseAnswer, type Answer } from './rsvp';

/** Far enough ahead to arrange anything a group of five would arrange, and a
 * bound on how far a client can push the calendar's paging. A year. */
const MAX_DAYS_AHEAD = 366;

/** The hour a night falls back to when the group has never had one. */
const DEFAULT_TIME = '21:00';

export interface DayVote {
  memberId: string;
  name: string;
  answer: Answer;
}

export interface PollDay {
  day: string;
  votes: DayVote[];
}

export interface PollState {
  /**
   * Whether the group is being asked when the next one is.
   *
   * There is no poll table and no "open" flag: a poll is open exactly when
   * there is no night still to come, which is a question the group's own row
   * already answers. One less thing that can get out of step with the truth.
   */
  open: boolean;
  /** Today as the group's calendar reads it — the floor on every vote, decided
   * here so a phone with a wrong clock cannot vote on yesterday. */
  today: string;
  /** What the lock-in form should offer, which is the hour they last used. */
  time: string;
  days: PollDay[];
}

async function stateFor(env: Env, session: Session, now = Date.now()): Promise<PollState> {
  const night = session.group.dadNight;
  const tz = night?.tz ?? 'America/Montreal';
  const today = civilDayIn(now, tz);

  // Days that have been and gone are not candidates and never come back, so
  // they are filtered on the way out rather than swept: a vote is a few bytes
  // and a DELETE is a write on every read of a screen a dad is only looking at.
  const { results } = await env.DB.prepare(
    `SELECT v.day, v.answer, v.member_id, m.display_name
       FROM night_votes v JOIN members m ON m.id = v.member_id
      WHERE v.group_id = ? AND v.day >= ?
      ORDER BY v.day, v.updated_at`,
  )
    .bind(session.group.id, today)
    .all<{ day: string; answer: string; member_id: string; display_name: string }>();

  const byDay = new Map<string, DayVote[]>();
  for (const row of results) {
    const answer = parseAnswer(row.answer);
    if (answer === null) continue;
    const votes = byDay.get(row.day) ?? [];
    votes.push({ memberId: row.member_id, name: row.display_name, answer });
    byDay.set(row.day, votes);
  }

  return {
    open: !stillToCome(night, now),
    today,
    time: night?.time ?? DEFAULT_TIME,
    days: [...byDay.entries()]
      .map(([day, votes]) => ({ day, votes }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** Is this a day somebody can still turn up on, and near enough to mean it? */
function inRange(day: string, today: string): boolean {
  if (weekdayOf(day) === null || day < today) return false;
  const ahead = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return ahead <= MAX_DAYS_AHEAD;
}

/** GET /api/poll — the calendar, and everyone's marks on it. */
export async function getPoll(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await stateFor(env, session));
}

/**
 * PUT /api/poll — { day, answer: 'in' | 'maybe' | 'out' | null }
 *
 * Null takes the mark off again, which is a different thing from "can't": one
 * is a man who has not looked at that day and the other is a man who has.
 *
 * Nothing is said in the room. Five dads marking a fortnight each would be
 * sixty lines about one decision, which is how a conversation becomes a
 * calendar. What IS announced is the poll opening and the date being locked
 * in — the two moments anybody needs to know about. Everyone looking at the
 * calendar right now finds out through a `poll` frame instead, which is a
 * nudge to re-read and not a line.
 */
export async function putVote(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: { day?: unknown; answer?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const day = typeof body.day === 'string' ? body.day : '';
  const tz = session.group.dadNight?.tz ?? 'America/Montreal';
  if (!inRange(day, civilDayIn(Date.now(), tz))) {
    return Response.json({ error: 'bad_day' }, { status: 400 });
  }

  const answer = body.answer === null ? null : parseAnswer(body.answer);
  if (answer === null && body.answer !== null) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  if (answer === null) {
    await env.DB.prepare('DELETE FROM night_votes WHERE group_id = ? AND member_id = ? AND day = ?')
      .bind(session.group.id, session.member.id, day)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO night_votes (group_id, member_id, day, answer, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(group_id, member_id, day)
         DO UPDATE SET answer = ?4, updated_at = ?5`,
    )
      .bind(session.group.id, session.member.id, day, answer, Date.now())
      .run();
  }

  await poke(env, session.group.id);
  return Response.json(await stateFor(env, session));
}

/**
 * POST /api/poll/pick — { day, time }
 *
 * Any dad locks it in, like the night and the three switches and for the same
 * reason: there is no admin in a group of five friends, and the room saying
 * who did it by name is the whole of the accountability this needs.
 *
 * The votes go with it. A round that survived into the next one would have
 * last month's marks sitting on a calendar nobody re-read, and a date is only
 * ever picked once.
 */
export async function pickDay(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: { day?: unknown; time?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const day = typeof body.day === 'string' ? body.day : '';
  const tz = session.group.dadNight?.tz ?? 'America/Montreal';
  if (!inRange(day, civilDayIn(Date.now(), tz))) {
    return Response.json({ error: 'bad_day' }, { status: 400 });
  }

  const weekday = weekdayOf(day);
  if (weekday === null) return Response.json({ error: 'bad_day' }, { status: 400 });

  const night: DadNight = {
    weekday,
    time: typeof body.time === 'string' && body.time !== '' ? body.time : DEFAULT_TIME,
    tz,
    date: day,
  };

  // The night first, the votes after. A cleared calendar with no night on it
  // is a group that has to start again; a night with a stale calendar behind
  // it is a screen nobody is looking at any more.
  const settled = await writeNight(env, session, night);
  await env.DB.prepare('DELETE FROM night_votes WHERE group_id = ?').bind(session.group.id).run();
  await poke(env, session.group.id);

  return Response.json({ night: settled, poll: await stateFor(env, session) });
}

/**
 * Tell every open phone the calendar moved.
 *
 * Not a line and not a notification: a frame the client answers by re-reading,
 * the same shape the roster and the room's switches use. Without it a dad
 * watching the calendar while another marks it sees nothing at all, and a
 * shared calendar that is not shared live is just two calendars.
 */
async function poke(env: Env, groupId: string): Promise<void> {
  const stub = env.ROOM.get(env.ROOM.idFromName(groupId));
  await stub.fetch('https://room/poll', {
    method: 'POST',
    headers: { [IDENTITY_HEADERS.groupId]: groupId },
  });
}
