import type { Room } from './room';

/** A timer in the `schedule` queue: one of each at most. */
export type TimerKind = 'night_start' | 'night_end' | 'night_remind';

export function arm(room: Room, kind: TimerKind, at: number): void {
  room.sql.exec('INSERT OR REPLACE INTO schedule (kind, due_at) VALUES (?, ?)', kind, at);
}

/** One alarm per object: always set it to the earliest thing pending, from
 * either queue — the leave grace (`leaving`) or the timers (`schedule`). */
export async function rescheduleAlarm(room: Room): Promise<void> {
  const next = room.sql
    .exec<{ at: number | null }>(
      `SELECT MIN(at) AS at FROM (
         SELECT MIN(leave_at) AS at FROM leaving
         UNION ALL
         SELECT MIN(due_at) AS at FROM schedule
       )`,
    )
    .one().at;
  if (next === null) await room.ctx.storage.deleteAlarm();
  else await room.ctx.storage.setAlarm(next);
}
