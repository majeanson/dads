import { describe, expect, it } from 'vitest';
import { REACTIONS } from '../src/shared/protocol';
import { counted, sixFor, type Tally } from '../src/web/favourites';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 23);

function use(tally: Tally, emoji: string, times: number, at = now): Tally {
  let t = tally;
  for (let i = 0; i < times; i++) t = counted(t, emoji, at);
  return t;
}

describe('the six marks a dad sees first', () => {
  it('are the defaults before he has used anything', () => {
    expect(sixFor({}, now)).toEqual([...REACTIONS]);
  });

  it('take in what he uses, pushing a default out from the end', () => {
    const six = sixFor(use({}, '🔥', 3), now);
    expect(six).toHaveLength(6);
    expect(six).toContain('🔥');
    // The defaults he has not touched keep their order; the last one gave way.
    expect(six.slice(0, 5)).toEqual(['👍', '❤️', '😂', '💪', '🙏']);
  });

  it('keep a default he uses over one he does not', () => {
    let t = use({}, '😎', 5);
    t = use(t, '🔥', 2);
    t = use(t, '🍺', 2);
    const six = sixFor(t, now);
    expect(six).toContain('😎');
    expect(six).toContain('🔥');
    expect(six).toContain('🍺');
  });

  it('let what he stopped using fade', () => {
    // Used a lot, two months ago; used a little, this week.
    let t = use({}, '🎉', 6, now - 60 * DAY);
    t = use(t, '🍺', 1);
    const six = sixFor(t, now);
    expect(six).toContain('🍺');
    expect(six.indexOf('🍺')).toBeLessThan(six.indexOf('🎉') === -1 ? 99 : six.indexOf('🎉'));
  });

  it('keep a default he uses daily over seven marks tapped once each', () => {
    // A default gives up its place only to a mark he uses MORE. It used to be
    // any mark he had used at all: seven taps on seven marks and the 👍 he
    // pressed every day of the week was gone from the row.
    let t: Tally = {};
    for (let d = 0; d < 7; d++) t = counted(t, '👍', now - d * DAY);
    for (const e of ['🔥', '🍺', '🎉', '👀', '🤝', '🏒', '⚽']) t = use(t, e, 1);
    const six = sixFor(t, now);
    expect(six).toHaveLength(6);
    expect(six[0]).toBe('👍');
  });

  it('never show more than six, whatever he has used', () => {
    let t: Tally = {};
    for (const e of ['🔥', '🍺', '🎉', '👀', '🤝', '🏒', '⚽', '🃏']) t = use(t, e, 3);
    expect(sixFor(t, now)).toHaveLength(6);
  });
});
