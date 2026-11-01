import { describe, expect, it } from 'vitest';
import { SWIPE_ARM_PX, SWIPE_MAX_PX, swipeEnd, swipeMove, swipeStart } from '../src/web/swipe';

/** Drag from (100, 100) through the points, returning every step. */
function drag(points: [number, number][]) {
  let s = swipeStart(100, 100);
  const buzzes: number[] = [];
  points.forEach(([x, y], i) => {
    const r = swipeMove(s, x, y);
    s = r.next;
    if (r.buzz) buzzes.push(i);
  });
  return { s, buzzes };
}

describe('a swipe to the right on a line', () => {
  it('is a reply once past the arming point, and buzzes once, there', () => {
    const { s, buzzes } = drag([
      [112, 101],
      [140, 103],
      [100 + SWIPE_ARM_PX, 104],
      [100 + SWIPE_ARM_PX + 20, 105],
    ]);
    expect(s.phase).toBe('sideways');
    expect(s.armed).toBe(true);
    expect(buzzes).toEqual([2]);
    expect(swipeEnd(s)).toBe(true);
  });

  it('is nothing if the finger lifts before the arming point', () => {
    const { s } = drag([[130, 100]]);
    expect(s.offset).toBe(30);
    expect(swipeEnd(s)).toBe(false);
  });

  it('never carries the line further than the cap', () => {
    const { s } = drag([[400, 100]]);
    expect(s.offset).toBe(SWIPE_MAX_PX);
  });

  it('is a scroll when the finger goes up or down first, and stays one', () => {
    const { s, buzzes } = drag([
      [102, 120],
      [180, 130],
    ]);
    expect(s.phase).toBe('scroll');
    expect(s.offset).toBe(0);
    expect(buzzes).toEqual([]);
    expect(swipeEnd(s)).toBe(false);
  });

  it('is nothing to the left', () => {
    const { s } = drag([[80, 100]]);
    expect(s.phase).toBe('scroll');
  });

  it('waits ten pixels before deciding', () => {
    const { s } = drag([[105, 104]]);
    expect(s.phase).toBe('undecided');
    expect(s.offset).toBe(0);
  });

  it('comes back from armed when the finger comes back', () => {
    const { s, buzzes } = drag([
      [100 + SWIPE_ARM_PX, 100],
      [120, 100],
    ]);
    expect(s.armed).toBe(false);
    expect(buzzes).toEqual([0]);
    expect(swipeEnd(s)).toBe(false);
  });
});
