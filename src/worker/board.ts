import { isoWeekIn, recentWeeks } from '../shared/week';
import type { Env } from './env';

/**
 * The weekly board: how each dad's week went, what he said he'd try, and
 * whether he did it.
 *
 * Everything here is group-visible by design. That was the decision behind the
 * whole feature — a private log nobody else sees is a diary, and the group
 * already agreed it wanted the other thing.
 */

export const MAX_NOTE_LENGTH = 280;
export const MAX_COMMITMENT_LENGTH = 200;
/** How far back the board shows. Enough to see whether a habit is forming. */
export const BOARD_WEEKS = 6;

export type Outcome = 'pending' | 'done' | 'missed';

export interface BoardRow {
  memberId: string;
  name: string;
  checkIn: { rating: number; note: string } | null;
  commitment: { body: string; outcome: Outcome; reflection: string } | null;
}

export interface BoardWeek {
  week: string;
  rows: BoardRow[];
}

export interface Board {
  /** The week the group is currently in, by its own clock. */
  week: string;
  weeks: BoardWeek[];
  /**
   * Your own commitment from last week, if you never said how it went. This is
   * what the new week opens by asking about.
   */
  pending: { week: string; body: string } | null;
}

/** The week the group is in right now. Its zone, not the viewer's. */
export async function currentWeek(env: Env, groupId: string, now = Date.now()): Promise<string> {
  const row = await env.DB.prepare('SELECT dad_night_tz FROM groups WHERE id = ?')
    .bind(groupId)
    .first<{ dad_night_tz: string }>();
  return isoWeekIn(now, row?.dad_night_tz ?? 'America/Montreal');
}

export async function buildBoard(
  env: Env,
  groupId: string,
  memberId: string,
  now = Date.now(),
): Promise<Board> {
  const week = await currentWeek(env, groupId, now);
  const weeks = recentWeeks(week, BOARD_WEEKS);
  const placeholders = weeks.map(() => '?').join(', ');

  // Members drive the rows, not the entries: a dad who did not check in has to
  // show up as a blank, or the board only ever flatters whoever turned up.
  const [members, checkIns, commitments] = await Promise.all([
    env.DB.prepare('SELECT id, display_name FROM members WHERE group_id = ? ORDER BY display_name')
      .bind(groupId)
      .all<{ id: string; display_name: string }>(),
    env.DB.prepare(
      `SELECT member_id, week, rating, note FROM check_ins
        WHERE group_id = ? AND week IN (${placeholders})`,
    )
      .bind(groupId, ...weeks)
      .all<{ member_id: string; week: string; rating: number; note: string }>(),
    env.DB.prepare(
      `SELECT member_id, week, body, outcome, reflection FROM commitments
        WHERE group_id = ? AND week IN (${placeholders})`,
    )
      .bind(groupId, ...weeks)
      .all<{
        member_id: string;
        week: string;
        body: string;
        outcome: Outcome;
        reflection: string;
      }>(),
  ]);

  const checkInBy = new Map(checkIns.results.map((r) => [`${r.week}:${r.member_id}`, r]));
  const commitmentBy = new Map(commitments.results.map((r) => [`${r.week}:${r.member_id}`, r]));

  const board: BoardWeek[] = weeks.map((w) => ({
    week: w,
    rows: members.results.map((m) => {
      const c = checkInBy.get(`${w}:${m.id}`);
      const k = commitmentBy.get(`${w}:${m.id}`);
      return {
        memberId: m.id,
        name: m.display_name,
        checkIn: c ? { rating: c.rating, note: c.note } : null,
        commitment: k ? { body: k.body, outcome: k.outcome, reflection: k.reflection } : null,
      };
    }),
  }));

  // "How did it go?" — asked about the most recent past week you left open,
  // not only the one immediately behind, so a fortnight away does not lose it.
  let pending: Board['pending'] = null;
  for (const w of weeks.slice(1)) {
    const mine = commitmentBy.get(`${w}:${memberId}`);
    if (mine && mine.outcome === 'pending') {
      pending = { week: w, body: mine.body };
      break;
    }
  }

  return { week, weeks: board, pending };
}
