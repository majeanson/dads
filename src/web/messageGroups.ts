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
  | {
      kind: 'message';
      key: number;
      message: RoomMessage;
      showName: boolean;
      /** A second line of the room's own that belongs to the same act as the
       * one above it — printed as its continuation rather than as news. */
      joined?: boolean;
    };

/** Consecutive lines from the same dad within this long are one turn. */
const SAME_TURN_MS = 5 * 60 * 1000;

/** A check-in and a commitment this close together are one sitting. */
const SAME_SITTING_MS = 2 * 60 * 1000;

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

/**
 * Which of the room's own lines say the same KIND of thing, so that only the
 * last one is worth keeping.
 *
 * Somebody moving dad night three times in an afternoon leaves three lines
 * saying where it is, two of which are wrong. The room should read like the
 * last one is the answer, because it is.
 */
/** Two of the room's own lines that are one act, said twice. */
function samePost(a: RoomMessage, b: RoomMessage): boolean {
  const ka = a.said?.k;
  const kb = b.said?.k;
  if (ka === undefined || kb === undefined) return false;
  // Filling in the week writes a check-in and a commitment a moment apart, by
  // the same dad, about the same thing. Two lines for one sitting.
  const pair =
    (ka === 'check_in' && kb === 'commitment') || (ka === 'commitment' && kb === 'check_in');
  const who =
    (a.said as { name?: string }).name === (b.said as { name?: string }).name &&
    (a.said as { name?: string }).name !== undefined;
  return pair && who && Math.abs(b.createdAt - a.createdAt) < SAME_SITTING_MS;
}

function supersedes(a: RoomMessage, b: RoomMessage): boolean {
  const ka = a.said?.k;
  const kb = b.said?.k;
  if (ka === undefined || kb === undefined) return false;
  // A dad who says he is in and then that he cannot has not said two things.
  if (ka === 'rsvp' && kb === 'rsvp') {
    return (a.said as { name: string }).name === (b.said as { name: string }).name;
  }
  return (
    (ka === 'night_set' || ka === 'night_cleared') && (kb === 'night_set' || kb === 'night_cleared')
  );
}

export function toRows(
  messages: RoomMessage[],
  now = Date.now(),
  names: DayNames = EN_DAYS,
): Row[] {
  // Drop a line the very next one makes untrue. Only ever the room's own, and
  // only ever a run of them with nothing said in between — a dad's message
  // between two of them means both were read.
  messages = messages.filter((message, i) => {
    const next = messages[i + 1];
    return next === undefined || !supersedes(message, next);
  });

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

    const joined = previous !== null && samePost(previous, message);
    rows.push({ kind: 'message', key: message.seq, message, showName: !sameTurn, joined });
    previous = message;
  }

  return rows;
}
