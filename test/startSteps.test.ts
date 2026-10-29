import { describe, expect, it } from 'vitest';
import { startSteps } from '../src/shared/startSteps';

const AT = Date.parse('2026-10-29T15:00:00Z');
const NEXT_THURSDAY = { weekday: 4, time: '21:00', tz: 'America/Montreal' } as const;

const done = (facts: Parameters<typeof startSteps>[0]) =>
  startSteps(facts).map((s) => `${s.step}:${s.done ? 'yes' : 'no'}`);

describe('startSteps', () => {
  it('lists the three in the order a night goes', () => {
    expect(
      startSteps({ alone: true, night: null, said: false, now: AT }).map((s) => s.step),
    ).toEqual(['invite', 'days', 'hi']);
  });

  it('is nothing done in a brand new room', () => {
    expect(done({ alone: true, night: null, said: false, now: AT })).toEqual([
      'invite:no',
      'days:no',
      'hi:no',
    ]);
  });

  it('reads each step off a fact, not a stored tick', () => {
    expect(done({ alone: false, night: NEXT_THURSDAY, said: true, now: AT })).toEqual([
      'invite:yes',
      'days:yes',
      'hi:yes',
    ]);
  });

  it('does not count a night that has already passed', () => {
    const passed = { weekday: 2, date: '2026-09-01', time: '21:00', tz: 'America/Montreal' };
    expect(done({ alone: true, night: passed, said: false, now: AT })[1]).toBe('days:no');
  });
});
