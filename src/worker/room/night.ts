import { currentWindow, isValidNight, nextStart, type DadNight } from '../../shared/dadNight';
import { dadNightReminder, notifyGroup } from '../push';
import type { Room } from './room';
import { arm } from './schedule';

/** How long before the table opens the phones are told. The evening before,
 * while a man can still move something. */
const REMIND_BEFORE_MS = 24 * 60 * 60 * 1000;

function storedNight(room: Room): DadNight | null {
  const raw = room.sql
    .exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'night'`)
    .toArray()[0]?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DadNight;
  } catch {
    return null;
  }
}

/**
 * Point the room at a schedule. Re-applying the same one is a no-op, so the
 * every-connection call costs nothing; a genuinely new night throws away the
 * old timers and arms fresh ones.
 */
export function applyNight(room: Room, night: DadNight | null): void {
  const current = storedNight(room);
  const same = JSON.stringify(current) === JSON.stringify(night);
  if (!same) {
    if (night) {
      room.sql.exec(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('night', ?)`,
        JSON.stringify(night),
      );
    } else {
      room.sql.exec(`DELETE FROM meta WHERE key = 'night'`);
    }
    room.sql.exec(`DELETE FROM schedule WHERE kind IN ('night_start','night_end','night_remind')`);
  }
  ensureNightScheduled(room);
}

/** Arm whichever end of the night comes next, if nothing is armed already. */
export function ensureNightScheduled(room: Room, now = Date.now()): void {
  const night = storedNight(room);
  if (!night || !isValidNight(night)) {
    room.sql.exec(`DELETE FROM schedule WHERE kind IN ('night_start','night_end','night_remind')`);
    return;
  }
  const armed = room.sql.exec('SELECT 1 FROM schedule').toArray().length;
  if (armed) return;

  // Setting a night mid-evening should not wait a week to mean anything: if
  // we are already inside a window, arm its end.
  const window = currentWindow(night, now);
  if (window) return arm(room, 'night_end', window.end);
  const start = nextStart(night, now);
  if (start === null) return;
  arm(room, 'night_start', start);
  // The day before, for the dads who asked to be told. A nudge on Wednesday
  // evening is the one that changes whether a man turns up on Thursday; the
  // one at 21:00 on the night only tells him what he is already missing.
  const remind = start - REMIND_BEFORE_MS;
  if (remind > now) arm(room, 'night_remind', remind);
}

/** Every timer in the queue that is due by `now`, fired once each. */
export async function timersDue(room: Room, now: number): Promise<void> {
  const timers = room.sql
    .exec<{ kind: string }>('SELECT kind FROM schedule WHERE due_at <= ?', now)
    .toArray();
  for (const timer of timers) {
    room.sql.exec('DELETE FROM schedule WHERE kind = ?', timer.kind);
    if (timer.kind === 'night_start') await openDadNight(room, now);
    else if (timer.kind === 'night_end') await closeDadNight(room, now);
    else if (timer.kind === 'night_remind') await remindOfDadNight(room);
  }
}

/**
 * Tomorrow night, to the phones that asked.
 *
 * Nothing is said in the room: a line saying "dad night tomorrow" every
 * single week is the definition of furniture, and the countdown is already
 * on the header for anyone who has the room open. This reaches the man who
 * does not.
 */
async function remindOfDadNight(room: Room): Promise<void> {
  const groupId = room.groupId();
  if (groupId === undefined) return;
  await notifyGroup(room.env, groupId, dadNightReminder());
}

async function openDadNight(room: Room, now: number): Promise<void> {
  const night = storedNight(room);
  // Still counted, and still said — to the phones that asked to be told,
  // which is not the conversation.
  const items = await itemsUpForTonight(room, night, now);

  const window = night ? currentWindow(night, now) : null;
  // If the alarm ran so late that the window already closed, there is
  // nothing to close; ensureNightScheduled arms next week instead.
  //
  // Armed BEFORE the notifications go out, not after: sending them is a
  // fan-out of HTTPS requests to services we do not run, and an alarm that
  // has not been re-armed yet is a summary that never happens because
  // somebody's push service was having a bad evening.
  if (window) arm(room, 'night_end', window.end);

  // The one thing this app does that reaches a dad who is not looking at
  // it, and only for the dads who asked for it.
  const groupId = room.groupId();
  if (groupId !== undefined) {
    await notifyGroup(room.env, groupId, {
      title: 'dads',
      body: items > 0 ? `The table’s open. ${items} to get into.` : 'The table’s open.',
      tag: 'dad-night',
    });
  }
}

/**
 * How many things the week put up for the evening now starting.
 *
 * Counted from D1: the list is written by a route and this object never
 * sees those writes go past.
 */
async function itemsUpForTonight(room: Room, night: DadNight | null, now: number): Promise<number> {
  const groupId = room.groupId();
  const start = night ? currentWindow(night, now)?.start : undefined;
  if (groupId === undefined || start === undefined) return 0;
  try {
    const row = await room.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM night_items WHERE group_id = ? AND occurrence = ?',
    )
      .bind(groupId, start)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch (err) {
    // A count that cannot be read is not a reason to skip opening the night.
    console.error('night items count failed', err);
    return 0;
  }
}

/**
 * The evening's window has closed.
 *
 * It used to count the room — how many turned up, how many lines, what the
 * week had in it — and post the whole thing as one line. The conversation
 * is what the dads typed now, and every number that line carried is on a
 * screen of its own: who came is the night sheet, the week is the week.
 *
 * What survives is the SCHEDULE. The alarm still has to fire, because a
 * night that has been and gone is what makes the next one arrangeable —
 * and a one-off that has used itself up leaves the group with no evening
 * to come, which is what turns home back into the calendar. That happens
 * because the night's date is in the past, not because anybody was told.
 */
async function closeDadNight(_room: Room, _now: number): Promise<void> {
  return Promise.resolve();
}
