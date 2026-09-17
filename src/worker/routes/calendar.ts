import { NIGHT_DURATION_MS, nextStart, repeats } from '../../shared/dadNight';
import type { Env } from '../env';
import { currentSession } from './auth';

/** iCalendar's day codes, in the same order as DadNight's weekday. */
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** "20260910T210000" — the wall clock in a given zone, which is what a TZID
 * DTSTART means. */
function civilStamp(ts: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(ts);
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${at('year')}${at('month')}${at('day')}T${at('hour')}${at('minute')}${at('second')}`;
}

function utcStamp(ts: number): string {
  return `${new Date(ts).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * GET /api/night.ics — the standing night, as a repeating appointment.
 *
 * The countdown in the room only reaches a dad who has opened the room. A
 * phone that already knows about Thursday reaches him in the middle of
 * Thursday afternoon, which is when it matters.
 *
 * DTSTART carries a TZID rather than a UTC instant, and the rule repeats
 * weekly: 21:00 stays 21:00 across a daylight-saving shift, which is the same
 * reason `dadNight.ts` stores a slot and not a timestamp. No VTIMEZONE block
 * travels with it — Apple, Google and Outlook all resolve IANA names, and a
 * hand-rolled one that drifts is worse than none.
 */
export async function getNightIcs(
  request: Request,
  env: Env,
  isProduction: boolean,
): Promise<Response> {
  const session = await currentSession(request, env, isProduction);
  if (!session) return new Response('unauthorized', { status: 401 });

  const night = session.group.dadNight;
  const start = night ? nextStart(night, Date.now()) : null;
  if (!night || start === null) return new Response('no night', { status: 404 });

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//dads//dad night//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    // The standing night is one event for ever, so one id. An arranged evening
    // is its own event and carries its date in the id: adding next month's
    // must not silently rewrite the one already in a man's calendar, and
    // rewriting it is exactly what a repeated UID asks a calendar to do.
    `UID:dad-night-${session.group.id}${night.date ? `-${night.date}` : ''}@dads`,
    `DTSTAMP:${utcStamp(Date.now())}`,
    `DTSTART;TZID=${night.tz}:${civilStamp(start, night.tz)}`,
    `DURATION:PT${NIGHT_DURATION_MS / 3_600_000}H`,
    // A night arranged for one evening gets no rule. An RRULE on it would put
    // a standing Thursday in five men's calendars off the back of one date
    // they agreed to, and taking a wrong repeating event out of a phone is
    // harder than putting the right single one in.
    ...(repeats(night) ? [`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[night.weekday] ?? 'TH'}`] : []),
    `SUMMARY:${session.group.name}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF, because RFC 5545 says so and at least one calendar app agrees.
  return new Response(`${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dad-night.ics"',
      'Cache-Control': 'no-store',
    },
  });
}
