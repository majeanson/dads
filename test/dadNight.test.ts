import { describe, expect, it } from 'vitest';
import {
  countdown,
  currentWindow,
  formatNight,
  isValidNight,
  NIGHT_DURATION_MS,
  nextStart,
  instantOfDay,
  parseDay,
  parseTime,
  phaseOf,
  previousStart,
  repeats,
  stillToCome,
  weekdayOf,
  type DadNight,
} from '../src/shared/dadNight';

const MONTREAL: DadNight = { weekday: 4, time: '21:00', tz: 'America/Montreal' };

/** What the group's own wall clock reads at an instant — the only thing a dad
 * actually experiences, and so what these tests assert on. */
function wallClock(ts: number, tz = MONTREAL.tz): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts));
}

const at = (iso: string) => Date.parse(iso);

describe('parsing and validation', () => {
  it('accepts a well-formed time and rejects the rest', () => {
    expect(parseTime('21:00')).toEqual({ hour: 21, minute: 0 });
    expect(parseTime('00:05')).toEqual({ hour: 0, minute: 5 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('21:60')).toBeNull();
    expect(parseTime('9:00')).toBeNull();
    expect(parseTime('nine')).toBeNull();
  });

  it('validates the whole night', () => {
    expect(isValidNight(MONTREAL)).toBe(true);
    expect(isValidNight({ ...MONTREAL, weekday: 7 })).toBe(false);
    expect(isValidNight({ ...MONTREAL, weekday: -1 })).toBe(false);
    expect(isValidNight({ ...MONTREAL, time: '9pm' })).toBe(false);
    expect(isValidNight({ ...MONTREAL, tz: 'Mars/Olympus' })).toBe(false);
  });

  it('names the night the way a dad would say it', () => {
    expect(formatNight(MONTREAL)).toBe('Thursdays at 21:00');
    expect(formatNight({ ...MONTREAL, weekday: 0, time: '09:30' })).toBe('Sundays at 09:30');
  });
});

describe('nextStart', () => {
  it('finds the coming Thursday from earlier in the week', () => {
    // Monday 2026-03-02, mid-morning in Montreal.
    const ts = nextStart(MONTREAL, at('2026-03-02T15:00:00Z'))!;
    expect(wallClock(ts)).toBe('Thu, 2026-03-05, 21:00');
  });

  it('still finds today’s night when it has not started yet', () => {
    // Thursday 2026-03-05, 18:00 in Montreal (23:00Z).
    const ts = nextStart(MONTREAL, at('2026-03-05T23:00:00Z'))!;
    expect(wallClock(ts)).toBe('Thu, 2026-03-05, 21:00');
  });

  it('rolls to next week once tonight’s night has started', () => {
    // Thursday 2026-03-05, 21:30 in Montreal.
    const ts = nextStart(MONTREAL, at('2026-03-06T02:30:00Z'))!;
    expect(wallClock(ts)).toBe('Thu, 2026-03-12, 21:00');
  });

  it('is exclusive: a start instant looks for the following week', () => {
    const first = nextStart(MONTREAL, at('2026-03-02T15:00:00Z'))!;
    expect(wallClock(nextStart(MONTREAL, first)!)).toBe('Thu, 2026-03-12, 21:00');
  });
});

describe('daylight saving', () => {
  // Montreal springs forward on Sunday 2026-03-08 and falls back on
  // Sunday 2026-11-01. The wall clock must not move either time.
  it('holds 21:00 across the spring-forward boundary', () => {
    const before = nextStart(MONTREAL, at('2026-03-02T15:00:00Z'))!;
    const after = nextStart(MONTREAL, at('2026-03-09T15:00:00Z'))!;
    expect(wallClock(before)).toBe('Thu, 2026-03-05, 21:00');
    expect(wallClock(after)).toBe('Thu, 2026-03-12, 21:00');
    // Same wall clock, one hour apart in UTC: EST is -5, EDT is -4.
    expect(new Date(before).toISOString()).toBe('2026-03-06T02:00:00.000Z');
    expect(new Date(after).toISOString()).toBe('2026-03-13T01:00:00.000Z');
  });

  it('holds 21:00 across the fall-back boundary', () => {
    const before = nextStart(MONTREAL, at('2026-10-26T15:00:00Z'))!;
    const after = nextStart(MONTREAL, at('2026-11-02T15:00:00Z'))!;
    expect(wallClock(before)).toBe('Thu, 2026-10-29, 21:00');
    expect(wallClock(after)).toBe('Thu, 2026-11-05, 21:00');
    expect(new Date(before).toISOString()).toBe('2026-10-30T01:00:00.000Z');
    expect(new Date(after).toISOString()).toBe('2026-11-06T02:00:00.000Z');
  });

  /**
   * This is the group's own zone, so it gets checked directly rather than
   * inferred from "Montreal is Eastern". All three spellings are the same
   * zone; whichever one ends up stored, a dad in Eastern gets 21:00.
   */
  it('gives every Eastern spelling the same instant, all year', () => {
    const eastern = ['America/Montreal', 'America/Toronto', 'America/New_York'];
    for (const from of ['2026-01-15T15:00:00Z', '2026-07-15T15:00:00Z', '2026-11-02T15:00:00Z']) {
      const starts = eastern.map((tz) => nextStart({ ...MONTREAL, tz }, at(from))!);
      expect(new Set(starts).size).toBe(1);
      for (const tz of eastern) {
        expect(wallClock(starts[0]!, tz)).toMatch(/^Thu, .*, 21:00$/);
      }
    }
  });

  it('keeps Eastern at 21:00 through a whole year of Thursdays', () => {
    // Every week for a year, including both changeovers. A single hour of
    // drift anywhere in here would fail.
    let cursor = at('2026-01-01T12:00:00Z');
    const seen: string[] = [];
    for (let week = 0; week < 52; week++) {
      const start = nextStart(MONTREAL, cursor)!;
      seen.push(wallClock(start));
      cursor = start;
    }
    expect(seen).toHaveLength(52);
    expect(seen.every((s) => s.startsWith('Thu, ') && s.endsWith(', 21:00'))).toBe(true);
    // 52 distinct Thursdays, none repeated or skipped.
    expect(new Set(seen).size).toBe(52);
  });

  it('works the same for a zone on the other side of the world', () => {
    const tokyo: DadNight = { weekday: 6, time: '10:00', tz: 'Asia/Tokyo' };
    const ts = nextStart(tokyo, at('2026-03-02T15:00:00Z'))!;
    expect(wallClock(ts, tokyo.tz)).toBe('Sat, 2026-03-07, 10:00');
  });

  it('handles a zone with a half-hour offset', () => {
    const kolkata: DadNight = { weekday: 2, time: '20:30', tz: 'Asia/Kolkata' };
    const ts = nextStart(kolkata, at('2026-03-02T15:00:00Z'))!;
    expect(wallClock(ts, kolkata.tz)).toBe('Tue, 2026-03-03, 20:30');
    expect(new Date(ts).toISOString()).toBe('2026-03-03T15:00:00.000Z');
  });
});

describe('previousStart and currentWindow', () => {
  it('finds the start of a night in progress', () => {
    // Thursday 22:30 Montreal, an hour and a half in.
    const now = at('2026-03-06T03:30:00Z');
    expect(wallClock(previousStart(MONTREAL, now)!)).toBe('Thu, 2026-03-05, 21:00');
    const window = currentWindow(MONTREAL, now)!;
    expect(wallClock(window.start)).toBe('Thu, 2026-03-05, 21:00');
    expect(window.end - window.start).toBe(NIGHT_DURATION_MS);
  });

  it('is not live a minute before, and is live at the stroke', () => {
    expect(currentWindow(MONTREAL, at('2026-03-06T01:59:00Z'))).toBeNull();
    expect(currentWindow(MONTREAL, at('2026-03-06T02:00:00Z'))).not.toBeNull();
  });

  it('is over the moment the window closes', () => {
    const start = at('2026-03-06T02:00:00Z');
    expect(currentWindow(MONTREAL, start + NIGHT_DURATION_MS - 1)).not.toBeNull();
    expect(currentWindow(MONTREAL, start + NIGHT_DURATION_MS)).toBeNull();
  });

  it('is not live on the wrong day', () => {
    expect(currentWindow(MONTREAL, at('2026-03-04T02:30:00Z'))).toBeNull();
  });
});

describe('phaseOf', () => {
  it('reports a night in progress', () => {
    const phase = phaseOf(MONTREAL, at('2026-03-06T03:00:00Z'))!;
    expect(phase.kind).toBe('live');
  });

  it('reports the wait otherwise', () => {
    const phase = phaseOf(MONTREAL, at('2026-03-02T15:00:00Z'))!;
    expect(phase.kind).toBe('upcoming');
    if (phase.kind !== 'upcoming') throw new Error('unreachable');
    expect(countdown(phase.startsIn)).toBe('in 3 days');
  });
});

describe('countdown', () => {
  it('rounds down, so nobody is told they have longer than they do', () => {
    expect(countdown(30_000)).toBe('any moment');
    expect(countdown(60_000)).toBe('any moment');
    expect(countdown(90_000)).toBe('in 1 minute');
    expect(countdown(59 * 60_000)).toBe('in 59 minutes');
    expect(countdown(60 * 60_000)).toBe('in 1 hour');
    expect(countdown(119 * 60_000)).toBe('in 1 hour');
    expect(countdown(23.9 * 3_600_000)).toBe('in 23 hours');
    expect(countdown(24 * 3_600_000)).toBe('in 1 day');
    expect(countdown(6.9 * 86_400_000)).toBe('in 6 days');
  });
});

/**
 * A night arranged for one evening.
 *
 * The slot is still a slot — a civil date and a wall-clock time in the group's
 * zone, never an instant — so everything DST-related below has to hold for a
 * one-off exactly as it does for the weekly one.
 */
describe('a night that happens once', () => {
  const ONCE: DadNight = { ...MONTREAL, date: '2026-03-26' };

  it('starts on its own date and nowhere else', () => {
    const start = nextStart(ONCE, at('2026-03-01T12:00:00Z'))!;
    expect(wallClock(start)).toBe('Thu, 2026-03-26, 21:00');
  });

  it('is not found in the week before it, the way a weekly slot would be', () => {
    // 19 March 2026 is also a Thursday. A search that walked seven days from
    // today would land on it; a one-off is simply its own date.
    const from = at('2026-03-16T12:00:00Z');
    expect(nextStart(MONTREAL, from)).not.toBe(nextStart(ONCE, from));
    expect(wallClock(nextStart(ONCE, from)!)).toBe('Thu, 2026-03-26, 21:00');
  });

  it('runs out: after its evening there is no next start at all', () => {
    const after = at('2026-03-27T12:00:00Z');
    expect(nextStart(ONCE, after)).toBeNull();
    expect(previousStart(ONCE, after)).not.toBeNull();
    expect(phaseOf(ONCE, after)).toBeNull();
    expect(stillToCome(ONCE, after)).toBe(false);
    // Which is the whole mechanism: a weekly night never runs out.
    expect(stillToCome(MONTREAL, after)).toBe(true);
  });

  it('is live during its own window and not a week later', () => {
    const during = at('2026-03-27T02:00:00Z');
    expect(phaseOf(ONCE, during)?.kind).toBe('live');
    expect(stillToCome(ONCE, during)).toBe(true);
    expect(currentWindow(ONCE, at('2026-04-03T02:00:00Z'))).toBeNull();
  });

  it('keeps its wall-clock hour across a daylight-saving shift', () => {
    // Montreal springs forward on 8 March 2026, so these two are the same
    // civil hour and a different number of hours from UTC.
    const before: DadNight = { ...MONTREAL, date: '2026-03-05' };
    const after: DadNight = { ...MONTREAL, date: '2026-03-12' };
    expect(wallClock(nextStart(before, at('2026-03-01T12:00:00Z'))!)).toBe(
      'Thu, 2026-03-05, 21:00',
    );
    expect(wallClock(nextStart(after, at('2026-03-01T12:00:00Z'))!)).toBe('Thu, 2026-03-12, 21:00');
  });

  it('refuses a date that disagrees with the weekday beside it', () => {
    // 26 March 2026 is a Thursday (4). Anything else is two answers to one
    // question, and the route derives the weekday from the date so that this
    // cannot arrive in the first place.
    expect(isValidNight(ONCE)).toBe(true);
    expect(isValidNight({ ...ONCE, weekday: 2 })).toBe(false);
    expect(isValidNight({ ...MONTREAL, date: '2026-02-30' })).toBe(false);
    expect(isValidNight({ ...MONTREAL, date: 'next thursday' })).toBe(false);
  });

  it('knows which of the two it is', () => {
    expect(repeats(MONTREAL)).toBe(true);
    expect(repeats(ONCE)).toBe(false);
    expect(repeats({ ...MONTREAL, date: null })).toBe(true);
    expect(formatNight(ONCE)).toBe('Thursday 2026-03-26 at 21:00');
  });
});

describe('civil dates', () => {
  it('reads a real one and refuses the rest', () => {
    expect(parseDay('2026-03-26')).toEqual({ year: 2026, month: 3, day: 26 });
    expect(parseDay('2024-02-29')).not.toBeNull();
    expect(parseDay('2026-02-29')).toBeNull();
    expect(parseDay('2026-13-01')).toBeNull();
    expect(parseDay('2026-3-26')).toBeNull();
    expect(parseDay('')).toBeNull();
  });

  it('knows the weekday, with no zone involved', () => {
    expect(weekdayOf('2026-03-26')).toBe(4);
    expect(weekdayOf('2026-03-29')).toBe(0);
    expect(weekdayOf('nope')).toBeNull();
  });

  it('turns a date and an hour into the instant that zone reads it at', () => {
    expect(wallClock(instantOfDay('2026-03-26', '21:00', MONTREAL.tz)!)).toBe(
      'Thu, 2026-03-26, 21:00',
    );
    expect(instantOfDay('2026-03-26', '99:99', MONTREAL.tz)).toBeNull();
  });
});
