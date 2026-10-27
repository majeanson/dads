import { civilDayIn, instantOfDay, parseDay, parseTime } from './dadNight';

/** A title is a few words: "Bowling", "Game at the Bell Centre". */
export const EVENT_TITLE_MAX = 60;
export const EVENT_PLACE_MAX = 80;

/** Enough for a season. Past this the list is a diary, not a plan. */
export const MAX_UPCOMING_EVENTS = 30;

/** How far ahead a date can be put down: two years is a typo, not a plan. */
export const EVENT_HORIZON_DAYS = 366;

/** The evening before, while a man can still move something. Same as the
 * night's. */
export const EVENT_REMIND_BEFORE_MS = 24 * 60 * 60 * 1000;

/** How long an event is still "on" after it starts: it stays on the list, and
 * its push is still worth sending. */
export const EVENT_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface EventInput {
  title: string;
  place: string;
  /** "YYYY-MM-DD" in the group's zone. */
  day: string;
  /** "HH:MM", the wall clock there. */
  time: string;
}

export type EventError = 'bad_request' | 'empty' | 'too_long' | 'bad_day' | 'bad_time' | 'past';

/** Collapse whitespace: a title is one line wherever it ends up (a push, an
 * .ics SUMMARY, a list row). */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * What a request body says, checked. Pure, so the worker pool and the tests
 * share one answer. `startsAt` is derived here and nowhere else.
 */
export function parseEventInput(
  raw: unknown,
  tz: string,
  now: number,
): { ok: true; value: EventInput; startsAt: number } | { ok: false; error: EventError } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'bad_request' };
  const body = raw as Record<string, unknown>;
  if (
    typeof body.title !== 'string' ||
    typeof body.day !== 'string' ||
    typeof body.time !== 'string'
  ) {
    return { ok: false, error: 'bad_request' };
  }
  if (body.place !== undefined && typeof body.place !== 'string') {
    return { ok: false, error: 'bad_request' };
  }

  const title = oneLine(body.title);
  const place = oneLine(typeof body.place === 'string' ? body.place : '');
  if (!title) return { ok: false, error: 'empty' };
  if ([...title].length > EVENT_TITLE_MAX || [...place].length > EVENT_PLACE_MAX) {
    return { ok: false, error: 'too_long' };
  }
  if (parseDay(body.day) === null) return { ok: false, error: 'bad_day' };
  if (parseTime(body.time) === null) return { ok: false, error: 'bad_time' };

  const today = civilDayIn(now, tz);
  const last = civilDayIn(now + EVENT_HORIZON_DAYS * 24 * 60 * 60 * 1000, tz);
  if (body.day < today || body.day > last) return { ok: false, error: 'bad_day' };

  const startsAt = instantOfDay(body.day, body.time, tz);
  if (startsAt === null) return { ok: false, error: 'bad_day' };
  if (startsAt < now) return { ok: false, error: 'past' };

  return { ok: true, value: { title, place, day: body.day, time: body.time }, startsAt };
}

/** When the push the evening before is due. It may already be past; the
 * route stamps such an event as reminded rather than sending it late. */
export function remindAt(startsAt: number): number {
  return startsAt - EVENT_REMIND_BEFORE_MS;
}

/** What a dad can answer. The night's three, and the same words. */
export type EventAnswerValue = 'in' | 'maybe' | 'out';

export interface EventAnswer {
  memberId: string;
  name: string;
  answer: EventAnswerValue;
}

/** One event as the wire carries it. */
export interface GroupEvent extends EventInput {
  id: string;
  tz: string;
  startsAt: number;
  /** The dad who put it up, and the only one who can change or cancel it. */
  memberId: string;
  name: string;
  answers: EventAnswer[];
}

export interface EventsState {
  /** Today as the GROUP's calendar reads it, never this phone's. */
  today: string;
  events: GroupEvent[];
}
