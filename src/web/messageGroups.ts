import type { RoomMessage } from '../shared/protocol';

/**
 * How a run of messages reads as a conversation rather than as a log.
 *
 * Two things a plain list gets wrong for a group that talks across days:
 * a dad's name repeated down five consecutive lines, and no way to tell
 * Tuesday from this morning.
 */

export type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: number; message: RoomMessage; showName: boolean };

/** Consecutive lines from the same dad within this long are one turn. */
const SAME_TURN_MS = 5 * 60 * 1000;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The two words that are not a date, and the locale for when it is one.
 *
 * Passed in rather than imported: this module is pure and is tested in the
 * worker pool, where a React context does not exist. English is the default
 * so the tests can go on calling it with two arguments.
 */
export interface DayNames {
  today: string;
  yesterday: string;
  locale?: string;
}

const EN_DAYS: DayNames = { today: 'Today', yesterday: 'Yesterday' };

/** "Today", "Yesterday", or a date — whichever a person would actually say. */
export function dayLabel(ts: number, now = Date.now(), names: DayNames = EN_DAYS): string {
  const today = dayKey(now);
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
  const key = dayKey(ts);
  if (key === today) return names.today;
  if (key === yesterday) return names.yesterday;
  return new Date(ts).toLocaleDateString(names.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

export function toRows(
  messages: RoomMessage[],
  now = Date.now(),
  names: DayNames = EN_DAYS,
): Row[] {
  const rows: Row[] = [];
  let lastDay: string | null = null;
  let previous: RoomMessage | null = null;

  for (const message of messages) {
    const key = dayKey(message.createdAt);
    if (key !== lastDay) {
      rows.push({ kind: 'day', key, label: dayLabel(message.createdAt, now, names) });
      lastDay = key;
      // A new day always reintroduces whoever speaks first.
      previous = null;
    }

    // Only a dad talking gets folded into a turn. A system or table line is
    // the room speaking, and an answer to the day's question is its own event
    // however many a dad posts in a row.
    const sameTurn =
      previous !== null &&
      message.kind === 'chat' &&
      previous.kind === 'chat' &&
      previous.memberId !== null &&
      previous.memberId === message.memberId &&
      message.createdAt - previous.createdAt < SAME_TURN_MS;

    rows.push({ kind: 'message', key: message.seq, message, showName: !sameTurn });
    previous = message;
  }

  return rows;
}
