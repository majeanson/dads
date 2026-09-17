/**
 * Dad night: a recurring weekly slot in the group's own timezone.
 *
 * The whole co-presence plan rests on this one thing being right. A slot is
 * stored as (weekday, wall-clock time, IANA zone) rather than as a timestamp
 * precisely so that "Thursdays at 21:00" stays 21:00 across a DST boundary
 * instead of quietly becoming 20:00 for half the year.
 *
 * Pure and dependency-free: the Worker, the Durable Object and the browser all
 * compute the same instants from the same inputs.
 */

export interface DadNight {
  /** 0 = Sunday … 6 = Saturday, in the group's zone. */
  weekday: number;
  /** "HH:MM", 24-hour, wall clock in the group's zone. */
  time: string;
  /** IANA zone name, e.g. "America/Montreal". */
  tz: string;
  /**
   * The one date it happens on, "YYYY-MM-DD" in the group's zone — or absent,
   * which means it happens every week.
   *
   * A civil date rather than an instant, for the same reason the weekly slot
   * is a weekday and not a timestamp: 21:00 on the 27th is 21:00 whatever the
   * offset is doing that week. `weekday` still agrees with it and is derived
   * from it on the way in, so the two can never disagree about which day this
   * is.
   *
   * This one field IS the "always the same day" switch. A night that repeats
   * has no particular date; a one-off has exactly one. Once its evening has
   * been and gone there is no next start, and a group with no next start is a
   * group whose next question is when the next one is.
   */
  date?: string | null;
}

/** How long a dad night counts as "on". Long enough to cover a late arrival. */
export const NIGHT_DURATION_MS = 3 * 60 * 60 * 1000;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Intl.DateTimeFormat construction is expensive and the client calls this on
// every countdown tick.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      // h23 rather than hour12:false: the latter can render midnight as "24".
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, fmt);
  }
  return fmt;
}

interface CivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** What the wall clock in `tz` reads at the instant `ts`. */
function civilTimeAt(ts: number, tz: string): CivilTime {
  const parts = formatterFor(tz).formatToParts(new Date(ts));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** The zone's offset from UTC, in ms, at the instant `ts`. */
function offsetAt(ts: number, tz: string): number {
  const c = civilTimeAt(ts, tz);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - ts;
}

/**
 * The instant at which the wall clock in `tz` reads the given civil time.
 *
 * Offsets are a function of the instant, and the instant is what we are
 * solving for, so this iterates: guess with the offset at the naive
 * interpretation, then correct with the offset actually in force there. Two
 * passes settle every real zone, including the hour a DST change moves.
 *
 * A wall time that does not exist (02:30 on a spring-forward morning) has no
 * exact answer; this lands on the instant the clock jumps to. Dad night is an
 * evening, so that case is theoretical.
 */
function instantOfCivil(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let ts = naive - offsetAt(naive, tz);
  ts = naive - offsetAt(ts, tz);
  return ts;
}

/** Civil weekday of a civil date — pure calendar arithmetic, no zone involved. */
function civilWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function shiftCivilDate(year: number, month: number, day: number, days: number) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The civil date in `tz` at instant `ts`, as "YYYY-MM-DD".
 *
 * A group's day turns over at its own midnight, not UTC's. Getting this wrong
 * would hand a group a new question in the middle of an evening.
 */
export function civilDayIn(ts: number, tz: string): string {
  const c = civilTimeAt(ts, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

/** "YYYY-MM-DD" → its parts, or null if it is not a real date. */
export function parseDay(day: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  // Round-tripping is what catches the 31st of February: Date normalises it
  // into March, and the parts then do not match what was asked for.
  const check = new Date(Date.UTC(year, month - 1, date));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    return null;
  }
  return { year, month, day: date };
}

/** Which weekday a civil date falls on, 0 = Sunday. No zone involved. */
export function weekdayOf(day: string): number | null {
  const parts = parseDay(day);
  return parts === null ? null : civilWeekday(parts.year, parts.month, parts.day);
}

/** The instant a wall-clock time on a civil date falls at, in a given zone. */
export function instantOfDay(day: string, time: string, tz: string): number | null {
  const date = parseDay(day);
  const clock = parseTime(time);
  if (!date || !clock) return null;
  return instantOfCivil(date.year, date.month, date.day, clock.hour, clock.minute, tz);
}

export function parseTime(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidNight(night: DadNight): boolean {
  const slot =
    Number.isInteger(night.weekday) &&
    night.weekday >= 0 &&
    night.weekday <= 6 &&
    parseTime(night.time) !== null &&
    isValidTimeZone(night.tz);
  if (!slot) return false;
  if (night.date === undefined || night.date === null) return true;
  // A date that disagrees with the weekday beside it is two answers to one
  // question. The route derives the weekday FROM the date, so this cannot
  // happen; refusing it here is what keeps that true.
  return weekdayOf(night.date) === night.weekday;
}

/** Does it happen again next week, or was it arranged for one evening? */
export function repeats(night: DadNight): boolean {
  return night.date === undefined || night.date === null;
}

/**
 * Every occurrence's start instant, searched from the civil date `from` falls
 * on, walking `direction` day by day. Yields at most 8 days so a match is
 * always found.
 */
function findStart(
  night: DadNight,
  from: number,
  direction: 1 | -1,
  accept: (ts: number) => boolean,
): number | null {
  const clock = parseTime(night.time);
  if (!clock) return null;
  const today = civilTimeAt(from, night.tz);
  for (let i = 0; i <= 7; i++) {
    const date = shiftCivilDate(today.year, today.month, today.day, i * direction);
    if (civilWeekday(date.year, date.month, date.day) !== night.weekday) continue;
    const ts = instantOfCivil(date.year, date.month, date.day, clock.hour, clock.minute, night.tz);
    if (accept(ts)) return ts;
  }
  return null;
}

/**
 * The one instant a one-off starts at, or null for a weekly slot.
 *
 * Separate from `findStart` on purpose: a one-off is not searched for, it is
 * simply the date it was arranged on — and a search that walks seven days out
 * from today would find it only in the week it happens to fall in.
 */
function fixedStart(night: DadNight): number | null {
  if (repeats(night)) return null;
  return instantOfDay(night.date as string, night.time, night.tz);
}

/** The next start strictly after `from`. */
export function nextStart(night: DadNight, from: number): number | null {
  if (!repeats(night)) {
    const ts = fixedStart(night);
    return ts !== null && ts > from ? ts : null;
  }
  return findStart(night, from, 1, (ts) => ts > from);
}

/** The most recent start at or before `at`. */
export function previousStart(night: DadNight, at: number): number | null {
  if (!repeats(night)) {
    const ts = fixedStart(night);
    return ts !== null && ts <= at ? ts : null;
  }
  return findStart(night, at, -1, (ts) => ts <= at);
}

/** The window `at` falls inside, or null if the night is not on right now. */
export function currentWindow(night: DadNight, at: number): { start: number; end: number } | null {
  const start = previousStart(night, at);
  if (start === null) return null;
  const end = start + NIGHT_DURATION_MS;
  return at < end ? { start, end } : null;
}

export type NightPhase =
  | { kind: 'live'; start: number; end: number }
  | { kind: 'upcoming'; start: number; startsIn: number };

export function phaseOf(night: DadNight, at: number): NightPhase | null {
  const window = currentWindow(night, at);
  if (window) return { kind: 'live', ...window };
  const start = nextStart(night, at);
  if (start === null) return null;
  return { kind: 'upcoming', start, startsIn: start - at };
}

/** "Thursdays at 21:00", or "Thursday 24 at 21:00" for a night arranged once. */
export function formatNight(night: DadNight): string {
  const day = WEEKDAY_NAMES[night.weekday] ?? '?';
  return repeats(night) ? `${day}s at ${night.time}` : `${day} ${night.date} at ${night.time}`;
}

/**
 * Is there an evening still to come?
 *
 * A weekly slot always has one. A one-off has one until it happens, and after
 * that the group has no night — which is not a group that forgot to set one,
 * it is a group whose next question is when the next one is. Every screen that
 * used to ask `night === null` asks this instead.
 */
export function stillToCome(night: DadNight | null, at: number): boolean {
  return night !== null && phaseOf(night, at) !== null;
}

/**
 * How long, in the largest unit that is still true.
 *
 * Rounded down, deliberately: "in 2 hours" at 1h59m is a small lie in the
 * direction that gets a dad to the table late.
 *
 * Parts rather than a sentence, because the sentence has to be written twice —
 * once in each language — and the arithmetic must not be.
 */
export function countdownParts(ms: number): {
  unit: 'now' | 'minutes' | 'hours' | 'days';
  n: number;
} {
  if (ms <= MINUTE) return { unit: 'now', n: 0 };
  if (ms < HOUR) return { unit: 'minutes', n: Math.floor(ms / MINUTE) };
  if (ms < DAY) return { unit: 'hours', n: Math.floor(ms / HOUR) };
  return { unit: 'days', n: Math.floor(ms / DAY) };
}

/** The English of the above, for the line the room archives. */
export function countdown(ms: number): string {
  const { unit, n } = countdownParts(ms);
  if (unit === 'now') return 'any moment';
  const word = unit.slice(0, -1);
  return `in ${n} ${word}${n === 1 ? '' : 's'}`;
}
