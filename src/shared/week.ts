import { civilDayIn } from './dadNight';

/**
 * ISO-8601 week numbering, in the group's own timezone.
 *
 * A week is the unit the check-in and the commitment live on, so it has to be
 * the same week for everyone in the group regardless of where they open the
 * app from — which is why it is computed from the group's zone, not the
 * browser's.
 *
 * ISO rules, which are not the obvious ones:
 *   - weeks start on Monday
 *   - week 1 is the week containing the first Thursday of the year
 * So the first days of January often belong to the last week of the previous
 * year, and 31 December is sometimes in week 1 of the next.
 */

const DAY = 86_400_000;

/** Monday = 0 … Sunday = 6. JS gives Sunday = 0, which ISO does not use. */
function isoDayIndex(utcMidnight: number): number {
  return (new Date(utcMidnight).getUTCDay() + 6) % 7;
}

/** The Thursday of the week a date falls in. Its year is the ISO week-year. */
function thursdayOf(utcMidnight: number): number {
  return utcMidnight + (3 - isoDayIndex(utcMidnight)) * DAY;
}

/** The Monday that starts week 1 of an ISO week-year. */
function week1Monday(isoYear: number): number {
  // 4 January is always in week 1, by definition.
  const jan4 = Date.UTC(isoYear, 0, 4);
  return jan4 - isoDayIndex(jan4) * DAY;
}

function format(isoYear: number, week: number): string {
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** The ISO week a civil date belongs to, as "YYYY-Www". */
export function isoWeekOfDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(year, month - 1, date);
  const thursday = thursdayOf(utcMidnight);
  const isoYear = new Date(thursday).getUTCFullYear();
  // Both are Thursdays at UTC midnight, so the gap is an exact multiple of a
  // week and rounding cannot drift.
  const week = 1 + Math.round((thursday - week1Monday(isoYear) - 3 * DAY) / (7 * DAY));
  return format(isoYear, week);
}

/** The ISO week an instant falls in, according to the group's clock. */
export function isoWeekIn(ts: number, tz: string): string {
  return isoWeekOfDay(civilDayIn(ts, tz));
}

export function parseWeek(week: string): { isoYear: number; week: number } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const number = Number(match[2]);
  if (number < 1 || number > 53) return null;
  return { isoYear, week: number };
}

/** UTC midnight of the Monday that starts the week. */
function mondayOf(week: string): number | null {
  const parsed = parseWeek(week);
  if (!parsed) return null;
  return week1Monday(parsed.isoYear) + (parsed.week - 1) * 7 * DAY;
}

/** The week before, crossing year boundaries correctly (53-week years included). */
export function previousWeek(week: string): string {
  const monday = mondayOf(week);
  if (monday === null) return week;
  const before = new Date(monday - 7 * DAY);
  return isoWeekOfDay(
    `${before.getUTCFullYear()}-${String(before.getUTCMonth() + 1).padStart(2, '0')}-${String(
      before.getUTCDate(),
    ).padStart(2, '0')}`,
  );
}

/** The `count` weeks ending with `week`, newest first. */
export function recentWeeks(week: string, count: number): string[] {
  const weeks = [week];
  for (let i = 1; i < count; i++) weeks.push(previousWeek(weeks[i - 1]!));
  return weeks;
}

/** "week of 7 Sep" — how a dad would refer to it, not "2026-W37". */
export function weekLabel(week: string): string {
  const monday = mondayOf(week);
  if (monday === null) return week;
  return `week of ${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(monday))}`;
}
