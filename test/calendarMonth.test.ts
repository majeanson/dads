import { describe, expect, it } from 'vitest';
import {
  compareMonths,
  dayOf,
  monthGrid,
  monthName,
  monthOf,
  shiftMonth,
  weekdayHeadings,
} from '../src/shared/calendarMonth';

describe('a month as a grid', () => {
  it('pads to whole weeks, Sunday first', () => {
    // 1 September 2026 is a Tuesday, so two blanks lead.
    const weeks = monthGrid({ year: 2026, month: 9 });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]!.slice(0, 3)).toEqual([null, null, '2026-09-01']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.flat().at(-1)).toBeNull();
  });

  it('pads with nulls rather than with the neighbouring month', () => {
    // A greyed-out 31st of August in September's first row is a tap that
    // means a day this grid is not about.
    const weeks = monthGrid({ year: 2026, month: 9 });
    expect(weeks.flat().filter((d) => d !== null && !d.startsWith('2026-09'))).toEqual([]);
  });

  it('knows how long February is', () => {
    expect(monthGrid({ year: 2026, month: 2 }).flat().filter(Boolean)).toHaveLength(28);
    expect(monthGrid({ year: 2028, month: 2 }).flat().filter(Boolean)).toHaveLength(29);
  });

  it('starts a month that begins on a Sunday with no padding at all', () => {
    // 1 November 2026 is a Sunday.
    expect(monthGrid({ year: 2026, month: 11 })[0]![0]).toBe('2026-11-01');
  });
});

describe('moving between months', () => {
  it('rolls the year over in both directions', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 3 }, 14)).toEqual({ year: 2027, month: 5 });
  });

  it('compares like the numbers they are, which is what disables the back button', () => {
    expect(compareMonths({ year: 2026, month: 9 }, { year: 2026, month: 9 })).toBe(0);
    expect(compareMonths({ year: 2026, month: 9 }, { year: 2026, month: 10 })).toBeLessThan(0);
    expect(compareMonths({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBeGreaterThan(0);
  });

  it('reads a month off a day, and writes one back', () => {
    expect(monthOf('2026-09-24')).toEqual({ year: 2026, month: 9 });
    expect(monthOf('nope')).toBeNull();
    expect(dayOf(2026, 9, 4)).toBe('2026-09-04');
  });
});

describe('the words around the grid', () => {
  it('names the month in the language being read', () => {
    expect(monthName('en', { year: 2026, month: 9 })).toBe('September 2026');
    expect(monthName('fr', { year: 2026, month: 9 })).toContain('2026');
  });

  it('heads the columns Sunday first, to match the grid', () => {
    const en = weekdayHeadings('en');
    expect(en).toHaveLength(7);
    expect(en[0]).toBe('Sun');
    expect(en[6]).toBe('Sat');
  });
});
