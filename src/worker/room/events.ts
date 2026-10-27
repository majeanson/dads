import { EVENT_REMIND_BEFORE_MS, EVENT_WINDOW_MS } from '../../shared/events';
import { eventReminder, eventStarting, notifyGroup } from '../push';
import type { Room } from './room';
import { arm } from './schedule';

/**
 * Arm the one `event_due` timer at whichever push is owed next, across every
 * event the group has.
 *
 * The queue holds one timer per kind, so events share a single one that means
 * "something about an event is due" and the answer to WHICH is read from D1
 * when it fires. D1 is the truth: the dads' events are written by routes this
 * object never sees go past.
 */
export async function ensureEventsScheduled(room: Room): Promise<void> {
  const groupId = room.groupId();
  if (groupId === undefined) return;
  try {
    const next = await room.env.DB.prepare(
      `SELECT MIN(at) AS at FROM (
         SELECT MIN(starts_at - ?2) AS at FROM events
          WHERE group_id = ?1 AND reminded_at IS NULL
         UNION ALL
         SELECT MIN(starts_at) AS at FROM events
          WHERE group_id = ?1 AND started_at IS NULL
       )`,
    )
      .bind(groupId, EVENT_REMIND_BEFORE_MS)
      .first<{ at: number | null }>();
    if (next?.at === null || next?.at === undefined) {
      room.sql.exec(`DELETE FROM schedule WHERE kind = 'event_due'`);
    } else {
      arm(room, 'event_due', next.at);
    }
  } catch (err) {
    // An unreadable list is not a reason to refuse a connection or an alarm.
    console.error('events schedule failed', err);
  }
}

interface Due {
  id: string;
  title: string;
  time: string;
  starts_at: number;
}

/**
 * The `event_due` timer fired: send every push that is owed by `now`, stamp
 * each so a restarted object cannot send it twice, then arm the next.
 *
 * Stamped BEFORE sending, for the reason the night's end is armed before its
 * notifications go out: a fan-out to push services we do not run is not a
 * thing to have an uncommitted flag riding on.
 */
export async function timersDueForEvents(room: Room, now: number): Promise<void> {
  const groupId = room.groupId();
  if (groupId === undefined) return;
  const db = room.env.DB;

  try {
    const remind = await db
      .prepare(
        `SELECT id, title, time, starts_at FROM events
          WHERE group_id = ? AND reminded_at IS NULL AND starts_at - ? <= ? AND starts_at > ?`,
      )
      .bind(groupId, EVENT_REMIND_BEFORE_MS, now, now)
      .all<Due>();
    // Anything that was already over when the alarm ran is stamped, not sent.
    await db
      .prepare(
        `UPDATE events SET reminded_at = ? WHERE group_id = ? AND reminded_at IS NULL
            AND starts_at - ? <= ?`,
      )
      .bind(now, groupId, EVENT_REMIND_BEFORE_MS, now)
      .run();

    const starting = await db
      .prepare(
        `SELECT id, title, time, starts_at FROM events
          WHERE group_id = ? AND started_at IS NULL AND starts_at <= ? AND starts_at > ?`,
      )
      .bind(groupId, now, now - EVENT_WINDOW_MS)
      .all<Due>();
    await db
      .prepare(
        `UPDATE events SET started_at = ? WHERE group_id = ? AND started_at IS NULL AND starts_at <= ?`,
      )
      .bind(now, groupId, now)
      .run();

    for (const event of remind.results) {
      await notifyGroup(room.env, groupId, eventReminder(event.title, event.time));
    }
    for (const event of starting.results) {
      await notifyGroup(room.env, groupId, eventStarting(event.title));
    }
  } catch (err) {
    console.error('events due failed', err);
  }

  await ensureEventsScheduled(room);
}
