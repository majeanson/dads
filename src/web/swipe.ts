/**
 * A swipe to the right on a line is a reply (Marc, 2026-11-01: "WhatsApp
 * has a swipe right on a message to reply, with a small vibration").
 *
 * The gesture, with no DOM in it so the worker pool can test it. A touch
 * goes down; the first ten pixels decide whether it is going sideways or
 * up and down (a scroll, which the browser keeps — `touch-action: pan-y`).
 * Sideways, the line follows the finger, never past `SWIPE_MAX_PX`, and at
 * `SWIPE_ARM_PX` it arms — the one moment the phone buzzes. Lifting while
 * armed is the reply; lifting before is nothing, and the line slides back.
 */

/** Past this, lifting the finger replies. */
export const SWIPE_ARM_PX = 56;
/** The line never travels further than this, whatever the finger does. */
export const SWIPE_MAX_PX = 88;
/** The first movement decides the direction. */
const DECIDE_PX = 10;

export interface Swipe {
  phase: 'undecided' | 'sideways' | 'scroll';
  x0: number;
  y0: number;
  /** How far right the line is, 0 unless sideways. */
  offset: number;
  armed: boolean;
}

export function swipeStart(x: number, y: number): Swipe {
  return { phase: 'undecided', x0: x, y0: y, offset: 0, armed: false };
}

/** The finger moved. `buzz` is true on the one move that arms it. */
export function swipeMove(s: Swipe, x: number, y: number): { next: Swipe; buzz: boolean } {
  if (s.phase === 'scroll') return { next: s, buzz: false };
  const dx = x - s.x0;
  const dy = y - s.y0;
  if (s.phase === 'undecided') {
    if (Math.abs(dy) >= DECIDE_PX && Math.abs(dy) > Math.abs(dx))
      return { next: { ...s, phase: 'scroll' }, buzz: false };
    if (Math.abs(dx) < DECIDE_PX) return { next: s, buzz: false };
    // A swipe to the LEFT is nothing here; the browser gets it back.
    if (dx < 0) return { next: { ...s, phase: 'scroll' }, buzz: false };
  }
  const offset = Math.max(0, Math.min(SWIPE_MAX_PX, dx));
  const armed = offset >= SWIPE_ARM_PX;
  return { next: { ...s, phase: 'sideways', offset, armed }, buzz: armed && !s.armed };
}

/** The finger lifted: whether that was a reply. */
export function swipeEnd(s: Swipe): boolean {
  return s.phase === 'sideways' && s.armed;
}
