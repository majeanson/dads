import { afterEach, describe, expect, it } from 'vitest';
import { HASHED_COLOURS } from '../src/shared/protocol';
import { chooseColours, DAD_COLOURS, dadColour, dadVar } from '../src/web/dadColour';

describe("a dad's colour", () => {
  afterEach(() => chooseColours(new Map()));

  it('is always one of the palette', () => {
    for (const id of ['mem_a', 'mem_b', 'mem_zc7-m1Tzg6PSFp9D', '', 'x'.repeat(200)]) {
      const n = dadColour(id);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(DAD_COLOURS);
    }
  });

  it('never changes for the same dad', () => {
    expect(dadColour('mem_marc')).toBe(dadColour('mem_marc'));
    expect(dadVar('mem_marc')).toBe(`var(--dad-${dadColour('mem_marc')})`);
  });

  it('spreads a room of men across the first six, the ones nobody chose', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => dadColour(`mem_${i}`)));
    expect(seen.size).toBe(HASHED_COLOURS);
    expect(Math.max(...seen)).toBe(HASHED_COLOURS);
  });

  it('gives a dad the colour he picked, from all twelve, and only him', () => {
    const was = dadColour('mem_other');
    chooseColours(new Map([['mem_marc', 11]]));
    expect(dadColour('mem_marc')).toBe(11);
    expect(dadVar('mem_marc')).toBe('var(--dad-11)');
    expect(dadColour('mem_other')).toBe(was);
  });
});
