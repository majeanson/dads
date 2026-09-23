import { describe, expect, it } from 'vitest';
import { DAD_COLOURS, dadColour, dadVar } from '../src/web/dadColour';

describe("a dad's colour", () => {
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

  it('spreads a room of men across the palette', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => dadColour(`mem_${i}`)));
    expect(seen.size).toBe(DAD_COLOURS);
  });
});
