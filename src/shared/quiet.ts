/**
 * When a dad does not want to be pushed at.
 *
 * Two things, modelled on what Google Chat does: a PAUSE ("snooze": an
 * instant until which nothing arrives, set in a tap) and a daily WINDOW (its
 * scheduled Do Not Disturb: two wall-clock times in the dad's own zone).
 * Either one silences a push. A silenced push is dropped, not held back and
 * delivered afterwards: a reminder that arrives at seven in the morning for a
 * night that was last evening is worse than none.
 *
 * Pure, so the worker and the tests read the same thing.
 */
export interface Quiet {
  from: string | null;
  to: string | null;
  tz: string | null;
  snoozedUntil: number | null;
}

export const NO_QUIET: Quiet = { from: null, to: null, tz: null, snoozedUntil: null };

/** The pauses on offer, and how long each is. */
export const SNOOZES = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
} as const;
export type Snooze = keyof typeof SNOOZES;

export function isSnooze(value: unknown): value is Snooze {
  return typeof value === 'string' && Object.hasOwn(SNOOZES, value);
}

/** "HH:MM", 24-hour, as the time field sends it. */
export function isClock(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Whether this is a zone the runtime knows: `Intl` throws on anything else. */
export function isZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Minutes since midnight, on the wall clock of `tz`, at `at`. */
function minuteOfDay(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return part('hour') * 60 + part('minute');
}

/**
 * Whether a push to this dad should be dropped right now.
 *
 * A window that runs past midnight (22:00 to 07:00) is the usual one, and
 * `from` is included, `to` is not: at exactly 07:00 he is back. Equal ends
 * mean no window rather than all day, which is a pause's job. Anything half
 * set or unreadable means not quiet: failing to silence is the safe side of
 * a reminder, and a stored zone the runtime no longer knows must not mute a
 * dad for ever.
 */
export function isQuiet(quiet: Quiet, now: number): boolean {
  if (quiet.snoozedUntil !== null && quiet.snoozedUntil > now) return true;
  const { from, to, tz } = quiet;
  if (!isClock(from) || !isClock(to) || !isZone(tz) || from === to) return false;
  const at = minuteOfDay(now, tz);
  const start = minutes(from);
  const end = minutes(to);
  return start < end ? at >= start && at < end : at >= start || at < end;
}
