import { describe, expect, it } from 'vitest';
import { isClock, isQuiet, isSnooze, isZone, NO_QUIET, type Quiet } from '../src/shared/quiet';

// 2026-10-29 in Montreal is on daylight saving until November 1st: UTC-4.
const at = (hhmm: string) => Date.parse(`2026-10-29T${hhmm}:00-04:00`);
const window = (from: string, to: string): Quiet => ({
  ...NO_QUIET,
  from,
  to,
  tz: 'America/Montreal',
});

describe('isQuiet', () => {
  it('is not quiet for a dad who never set anything', () => {
    expect(isQuiet(NO_QUIET, at('03:00'))).toBe(false);
  });

  it('holds a pause until its instant, and not after', () => {
    const pause: Quiet = { ...NO_QUIET, snoozedUntil: at('21:00') };
    expect(isQuiet(pause, at('20:59'))).toBe(true);
    expect(isQuiet(pause, at('21:00'))).toBe(false);
    expect(isQuiet(pause, at('21:01'))).toBe(false);
  });

  it('holds a same-day window, from included and to not', () => {
    const lunch = window('12:00', '13:00');
    expect(isQuiet(lunch, at('11:59'))).toBe(false);
    expect(isQuiet(lunch, at('12:00'))).toBe(true);
    expect(isQuiet(lunch, at('12:59'))).toBe(true);
    expect(isQuiet(lunch, at('13:00'))).toBe(false);
  });

  it('holds a window that runs past midnight', () => {
    const night = window('22:00', '07:00');
    expect(isQuiet(night, at('21:59'))).toBe(false);
    expect(isQuiet(night, at('22:00'))).toBe(true);
    expect(isQuiet(night, at('23:59'))).toBe(true);
    expect(isQuiet(night, at('00:00'))).toBe(true);
    expect(isQuiet(night, at('06:59'))).toBe(true);
    expect(isQuiet(night, at('07:00'))).toBe(false);
    expect(isQuiet(night, at('12:00'))).toBe(false);
  });

  it('reads the window on HIS clock, not the room or the server', () => {
    const night = window('22:00', '07:00');
    // 03:00 in Montreal is 09:00 in Paris, and 00:00 in Vancouver.
    expect(isQuiet(night, at('03:00'))).toBe(true);
    expect(isQuiet({ ...night, tz: 'Europe/Paris' }, at('03:00'))).toBe(false);
    expect(isQuiet({ ...night, tz: 'America/Vancouver' }, at('03:00'))).toBe(true);
  });

  it('follows daylight saving: the clock moves, the window does not', () => {
    const night = window('22:00', '07:00');
    // After the change Montreal is UTC-5, so 02:30 UTC is 21:30 and 03:30 is 22:30.
    expect(isQuiet(night, Date.parse('2026-11-03T02:30:00Z'))).toBe(false);
    expect(isQuiet(night, Date.parse('2026-11-03T03:30:00Z'))).toBe(true);
  });

  it('treats equal ends as no window, not all day', () => {
    expect(isQuiet(window('08:00', '08:00'), at('08:00'))).toBe(false);
  });

  it('fails open on anything half set or unreadable', () => {
    expect(isQuiet({ ...window('22:00', '07:00'), tz: null }, at('23:00'))).toBe(false);
    expect(isQuiet({ ...window('22:00', '07:00'), tz: 'Not/AZone' }, at('23:00'))).toBe(false);
    expect(isQuiet({ ...window('22:00', '07:00'), to: null }, at('23:00'))).toBe(false);
    expect(isQuiet(window('25:00', '07:00'), at('23:00'))).toBe(false);
  });

  it('lets either one silence him', () => {
    const both: Quiet = { ...window('22:00', '07:00'), snoozedUntil: at('15:00') };
    expect(isQuiet(both, at('14:00'))).toBe(true);
    expect(isQuiet(both, at('23:00'))).toBe(true);
    expect(isQuiet(both, at('16:00'))).toBe(false);
  });
});

describe('what the route accepts', () => {
  it('knows a clock, a zone and a pause', () => {
    expect(isClock('07:30')).toBe(true);
    expect(isClock('7:30')).toBe(false);
    expect(isClock('24:00')).toBe(false);
    expect(isClock(730)).toBe(false);
    expect(isZone('America/Montreal')).toBe(true);
    expect(isZone('Nowhere/Land')).toBe(false);
    expect(isZone('')).toBe(false);
    expect(isSnooze('8h')).toBe(true);
    expect(isSnooze('2h')).toBe(false);
    expect(isSnooze('toString')).toBe(false);
  });
});
