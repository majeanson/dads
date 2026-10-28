import type { Profile } from '../../shared/profile';
import { currentWeek } from '../board';
import type { Env } from '../env';
import { currentSession } from './auth';
import { occurrenceOf, parseAnswer } from './rsvp';

/** Enough to see what a dad has been saying; past this it is the archive. */
const MAX_ANSWERS = 30;
const MAX_EVENTS = 20;

/**
 * GET /api/profile?member= — one dad, as the rest of the room can read him.
 *
 * Nothing here is private to him: every part is something the group already
 * sees (his answers sit under the question, his week on the board, his
 * replies on the calendar). It is those, in one place. Scoped to the
 * caller's group, and a dad who has left is not found.
 */
export async function getProfile(
  request: Request,
  env: Env,
  url: URL,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const groupId = session.group.id;
  const memberId = url.searchParams.get('member') ?? '';
  const member = await env.DB.prepare(
    'SELECT id, display_name, joined_at FROM members WHERE id = ? AND group_id = ? AND gone_at IS NULL',
  )
    .bind(memberId, groupId)
    .first<{ id: string; display_name: string; joined_at: number }>();
  if (!member) return Response.json({ error: 'not_found' }, { status: 404 });

  const now = Date.now();
  const occurrence = occurrenceOf(session.group.dadNight, now);
  const nightRow =
    occurrence === null
      ? null
      : await env.DB.prepare(
          'SELECT answer FROM rsvps WHERE group_id = ? AND member_id = ? AND occurrence = ?',
        )
          .bind(groupId, memberId, occurrence)
          .first<{ answer: string }>();

  const { results: eventRows } = await env.DB.prepare(
    `SELECT e.id, e.title, e.place, e.day, e.time, e.member_id, r.answer
       FROM events e
       LEFT JOIN event_rsvps r ON r.event_id = e.id AND r.member_id = ?2
      WHERE e.group_id = ?1 AND e.starts_at >= ?3 AND (e.member_id = ?2 OR r.member_id = ?2)
      ORDER BY e.starts_at
      LIMIT ?4`,
  )
    .bind(groupId, memberId, now, MAX_EVENTS)
    .all<{
      id: string;
      title: string;
      place: string;
      day: string;
      time: string;
      member_id: string;
      answer: string | null;
    }>();

  let answers: Profile['answers'] = null;
  if (session.group.rooms.questions) {
    const { results } = await env.DB.prepare(
      `SELECT msg.id, msg.body, msg.created_at, p.body AS question, p.body_fr AS question_fr
         FROM messages msg JOIN prompts p ON p.id = msg.prompt_id
        WHERE msg.group_id = ? AND msg.member_id = ? AND msg.kind = 'prompt'
        ORDER BY msg.created_at DESC
        LIMIT ?`,
    )
      .bind(groupId, memberId, MAX_ANSWERS)
      .all<{
        id: string;
        body: string;
        created_at: number;
        question: string;
        question_fr: string | null;
      }>();
    answers = results.map((r) => ({
      id: r.id,
      at: r.created_at,
      question: r.question,
      questionFr: r.question_fr,
      body: r.body,
    }));
  }

  let week: Profile['week'] = null;
  if (session.group.rooms.week) {
    const thisWeek = await currentWeek(env, groupId, now);
    const [checkIn, commitment] = await Promise.all([
      env.DB.prepare(
        'SELECT rating, note FROM check_ins WHERE group_id = ? AND member_id = ? AND week = ?',
      )
        .bind(groupId, memberId, thisWeek)
        .first<{ rating: number; note: string }>(),
      env.DB.prepare(
        'SELECT body, outcome FROM commitments WHERE group_id = ? AND member_id = ? AND week = ?',
      )
        .bind(groupId, memberId, thisWeek)
        .first<{ body: string; outcome: string }>(),
    ]);
    week = { checkIn: checkIn ?? null, commitment: commitment ?? null };
  }

  const profile: Profile = {
    memberId: member.id,
    name: member.display_name,
    joinedAt: member.joined_at,
    night: nightRow ? parseAnswer(nightRow.answer) : null,
    events: eventRows.map((e) => ({
      id: e.id,
      title: e.title,
      place: e.place,
      day: e.day,
      time: e.time,
      hosting: e.member_id === memberId,
      answer: e.answer === null ? null : parseAnswer(e.answer),
    })),
    answers,
    week,
  };
  return Response.json(profile);
}
