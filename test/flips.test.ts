import { describe, expect, it } from 'vitest';
import type { RoomsOpen } from '../src/shared/protocol';
import { settleFlips, shownSwitches, withoutFlip } from '../src/web/flips';

/** Settings' switches: his flips on top of what the room says (2026-11-02). */
describe('switches that follow the room', () => {
  const room: RoomsOpen = { questions: true, week: true, table: true };

  it('shows the room as it is when nothing was flipped here', () => {
    expect(shownSwitches(room, {})).toEqual(room);
    // Another phone turned the table off: this screen follows.
    expect(shownSwitches({ ...room, table: false }, {})).toEqual({ ...room, table: false });
  });

  it('shows a flip at once, before the room has said anything', () => {
    expect(shownSwitches(room, { week: false })).toEqual({ ...room, week: false });
  });

  it('keeps a flip until the room says the same thing, then lets it go', () => {
    const flips = { week: false };
    // The room has not caught up: the same object, nothing to render.
    expect(settleFlips(room, flips)).toBe(flips);
    // It has: the flip goes, and what shows is the room's.
    expect(settleFlips({ ...room, week: false }, flips)).toEqual({});
    // Only the one that agrees goes.
    expect(settleFlips({ ...room, week: false }, { week: false, table: false })).toEqual({
      table: false,
    });
  });

  it('drops a flip that failed, and the room shows again', () => {
    const flips = withoutFlip({ week: false, table: false }, 'week');
    expect(flips).toEqual({ table: false });
    expect(shownSwitches(room, flips)).toEqual({ ...room, table: false });
  });
});
