import { describe, expect, it } from 'vitest';
import { FIT_LIMITS, parseFit } from '../src/shared/protocol';

describe('parseFit', () => {
  it('takes three numbers and rounds them', () => {
    expect(parseFit({ x: 0.12345, y: -0.0501, s: 1.23456 })).toEqual({
      x: 0.123,
      y: -0.05,
      s: 1.235,
    });
  });

  it('clamps to the limits rather than refusing: a drag off the edge meant "as far as it goes"', () => {
    expect(parseFit({ x: 5, y: -5, s: 0 })).toEqual({
      x: FIT_LIMITS.x,
      y: -FIT_LIMITS.y,
      s: FIT_LIMITS.sMin,
    });
    expect(parseFit({ x: -5, y: 5, s: 50 })).toEqual({
      x: -FIT_LIMITS.x,
      y: FIT_LIMITS.y,
      s: FIT_LIMITS.sMax,
    });
  });

  it('refuses anything that is not three finite numbers', () => {
    for (const bad of [
      null,
      undefined,
      'up a bit',
      42,
      {},
      { x: 0, y: 0 },
      { x: '0', y: 0, s: 1 },
      { x: Number.NaN, y: 0, s: 1 },
      { x: 0, y: Number.POSITIVE_INFINITY, s: 1 },
    ]) {
      expect(parseFit(bad)).toBeNull();
    }
  });
});
