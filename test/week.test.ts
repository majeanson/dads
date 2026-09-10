import { describe, expect, it } from 'vitest';
import {
  isoWeekIn,
  isoWeekOfDay,
  parseWeek,
  previousWeek,
  recentWeeks,
  weekLabel,
} from '../src/shared/week';

describe('isoWeekOfDay', () => {
  it('numbers an ordinary week', () => {
    // Monday 2026-09-07 through Sunday 2026-09-13 are all one week.
    for (const day of [
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]) {
      expect(isoWeekOfDay(day)).toBe('2026-W37');
    }
    // The next Monday starts a new one.
    expect(isoWeekOfDay('2026-09-14')).toBe('2026-W38');
  });

  it('puts early January in the previous year when ISO says so', () => {
    // 2027-01-01 is a Friday, so it belongs to the last week of 2026.
    expect(isoWeekOfDay('2027-01-01')).toBe('2026-W53');
    expect(isoWeekOfDay('2027-01-03')).toBe('2026-W53');
    expect(isoWeekOfDay('2027-01-04')).toBe('2027-W01');
  });

  it('puts late December in the next year when ISO says so', () => {
    // 2024-12-30 is a Monday; that week's Thursday is in 2025.
    expect(isoWeekOfDay('2024-12-30')).toBe('2025-W01');
    expect(isoWeekOfDay('2024-12-29')).toBe('2024-W52');
  });

  it('knows 2026 is a 53-week year', () => {
    expect(isoWeekOfDay('2026-12-28')).toBe('2026-W53');
    expect(isoWeekOfDay('2026-12-31')).toBe('2026-W53');
  });

  it('starts a normal year at week 1', () => {
    expect(isoWeekOfDay('2026-01-01')).toBe('2026-W01');
    expect(isoWeekOfDay('2025-01-01')).toBe('2025-W01');
  });
});

describe('isoWeekIn', () => {
  it('uses the group’s clock, not UTC', () => {
    // Monday 2026-09-14 at 01:00 UTC is still Sunday evening in Montreal, so
    // for the group it is the week that is ending, not the one starting.
    const ts = Date.parse('2026-09-14T01:00:00Z');
    expect(isoWeekIn(ts, 'America/Montreal')).toBe('2026-W37');
    expect(isoWeekIn(ts, 'UTC')).toBe('2026-W38');
  });

  it('rolls over at the group’s Monday midnight', () => {
    expect(isoWeekIn(Date.parse('2026-09-14T03:59:00Z'), 'America/Montreal')).toBe('2026-W37');
    expect(isoWeekIn(Date.parse('2026-09-14T04:01:00Z'), 'America/Montreal')).toBe('2026-W38');
  });
});

describe('previousWeek', () => {
  it('steps back within a year', () => {
    expect(previousWeek('2026-W37')).toBe('2026-W36');
  });

  it('steps back across a year boundary into a 53-week year', () => {
    expect(previousWeek('2027-W01')).toBe('2026-W53');
    expect(previousWeek('2026-W01')).toBe('2025-W52');
  });

  it('walks a hundred weeks without landing anywhere impossible', () => {
    let week = '2027-W05';
    for (let i = 0; i < 100; i++) {
      week = previousWeek(week);
      const parsed = parseWeek(week);
      expect(parsed).not.toBeNull();
      expect(parsed!.week).toBeGreaterThanOrEqual(1);
      expect(parsed!.week).toBeLessThanOrEqual(53);
    }
    // Two years back, landing where a 53-week 2026 puts it.
    expect(week).toBe('2025-W10');
  });

  it('round-trips against isoWeekOfDay', () => {
    // Seven days before a Monday is the previous week, by construction.
    expect(previousWeek(isoWeekOfDay('2026-09-14'))).toBe(isoWeekOfDay('2026-09-07'));
  });
});

describe('recentWeeks', () => {
  it('lists newest first with no gaps or repeats', () => {
    const weeks = recentWeeks('2027-W02', 5);
    expect(weeks).toEqual(['2027-W02', '2027-W01', '2026-W53', '2026-W52', '2026-W51']);
    expect(new Set(weeks).size).toBe(5);
  });
});

describe('parseWeek and weekLabel', () => {
  it('rejects nonsense', () => {
    expect(parseWeek('2026-W00')).toBeNull();
    expect(parseWeek('2026-W54')).toBeNull();
    expect(parseWeek('2026-37')).toBeNull();
    expect(parseWeek('nope')).toBeNull();
  });

  it('labels a week the way a dad would say it', () => {
    // en-GB abbreviates September as "Sept"; that is the correct British form.
    expect(weekLabel('2026-W37')).toBe('week of 7 Sept');
    expect(weekLabel('2026-W01')).toBe('week of 29 Dec');
  });
});
