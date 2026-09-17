/**
 * A month, as a grid of civil dates.
 *
 * Pure calendar arithmetic and nothing else: no zone, no instants, no clock.
 * A day here is the string a group's own calendar reads — "2026-09-24" — and
 * turning one into an instant is `dadNight.ts`'s job, which is the only place
 * in this app allowed to know what an offset is.
 *
 * Sunday-first, because the weekday names the night editor already offers
 * start at Sunday and a grid whose columns are indexed differently from the
 * rest of the app is a bug waiting for a Monday.
 *
 * The month name and the weekday headings come from `Intl` rather than from
 * the dictionary. Twelve month names and seven day names in two languages is
 * thirty-eight strings the browser already has, held level by a test for no
 * reason — and Intl gets the French capitalisation right, which we would not.
 */

import { parseDay } from './dadNight';

export interface Month {
  year: number;
  /** 1 = January … 12 = December. */
  month: number;
}

export function monthOf(day: string): Month | null {
  const parts = parseDay(day);
  return parts === null ? null : { year: parts.year, month: parts.month };
}

export function shiftMonth({ year, month }: Month, by: number): Month {
  const zeroBased = year * 12 + (month - 1) + by;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** Negative when `a` is earlier. Months compare like the numbers they are. */
export function compareMonths(a: Month, b: Month): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function dayOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The weeks of a month, Sunday first, padded with nulls so every row is seven
 * cells wide and the columns line up with the headings.
 *
 * Nulls rather than the neighbouring month's dates: a cell a dad can tap must
 * be a day this grid is actually about, and a greyed-out 31st of last August
 * sitting in September's first row is a tap that means something he did not
 * intend.
 */
export function monthGrid({ year, month }: Month): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => dayOf(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "September 2026" / "septembre 2026", from the browser's own tables. */
export function monthName(lang: string, { year, month }: Month): string {
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(year, month - 1, 1),
  );
}

/** The seven column headings, Sunday first, in their shortest useful form. */
export function weekdayHeadings(lang: string): string[] {
  const fmt = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' });
  // 4 January 1970 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(Date.UTC(1970, 0, 4 + i)));
}

/** "Thursday 24 September" — a date said the way a person says one. */
export function dayName(lang: string, day: string): string {
  const parts = parseDay(day);
  if (parts === null) return day;
  return new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/** The same, short enough for a row that also carries a count and a button. */
export function dayNameShort(lang: string, day: string): string {
  const parts = parseDay(day);
  if (parts === null) return day;
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(Date.UTC(parts.year, parts.month - 1, parts.day));
}
