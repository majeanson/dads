/**
 * Hold the microphone to talk, lift to send, slide left to throw it away
 * (Marc asked, 2026-11-02: the convention every phone chat has).
 *
 * The gesture with no DOM in it, so the worker pool can test it. A pointer
 * goes down on the microphone and nothing happens yet: `HOLD_MS` later it
 * is a hold, the recording starts and the phone buzzes once. From then the
 * finger may wander (the button holds the pointer); `CANCEL_PX` to the left
 * of where it went down arms the cancel, with one more buzz, and lifting
 * there throws the note away. Lifting anywhere else sends it.
 *
 * A press shorter than the hold is a TAP, and a tap is what it always was:
 * the click that follows it starts a hands-free recording, with a cancel
 * and a send on the row, for a dad with one hand on a child. A keyboard's
 * Enter or Space is a click with no pointer before it, and does the same.
 *
 * The browser can take the pointer away mid-hold (`lost`, a pointercancel):
 * the microphone's permission prompt does it the first time. The recording
 * is not lost with it — the gesture lets go and the row becomes the
 * hands-free one, so he finishes with the two buttons instead.
 */

/** Shorter than this is a tap: a thumb that landed on the microphone by
 * mistake does not start anything until it lifts. */
export const HOLD_MS = 150;
/** This far left of where the finger went down, lifting throws it away. */
export const CANCEL_PX = 80;

export type Hold =
  /** Nothing under the finger. */
  | { kind: 'idle' }
  /** Down, not yet long enough to be a hold. */
  | { kind: 'pressing'; x0: number }
  /** A hold: recording, the finger still down. `dx` is never positive. */
  | { kind: 'held'; x0: number; dx: number; armed: boolean }
  /** A hold just ended; the click the lift turns into is not a tap. */
  | { kind: 'spent' };

export type HoldEvent =
  | { t: 'down'; x: number }
  /** `HOLD_MS` passed since the last `down`. */
  | { t: 'elapsed' }
  | { t: 'move'; x: number }
  /** The finger lifted. `live` is whether the recording has really begun
   * (the microphone may still be being asked for). */
  | { t: 'up'; live: boolean }
  /** The browser took the pointer: a pointercancel. */
  | { t: 'lost' }
  | { t: 'click' };

/** What the composer does about it. */
export type HoldEffect = 'start' | 'send' | 'discard' | 'buzz';

export const IDLE: Hold = { kind: 'idle' };

export function holdStep(s: Hold, e: HoldEvent): { next: Hold; effects: HoldEffect[] } {
  const stay = { next: s, effects: [] as HoldEffect[] };
  switch (e.t) {
    case 'down':
      // A second finger while one is already down is not a new press.
      if (s.kind === 'held' || s.kind === 'pressing') return stay;
      return { next: { kind: 'pressing', x0: e.x }, effects: [] };
    case 'elapsed':
      if (s.kind !== 'pressing') return stay;
      return {
        next: { kind: 'held', x0: s.x0, dx: 0, armed: false },
        effects: ['start', 'buzz'],
      };
    case 'move': {
      if (s.kind !== 'held') return stay;
      const dx = Math.min(0, e.x - s.x0);
      const armed = dx <= -CANCEL_PX;
      return {
        next: { kind: 'held', x0: s.x0, dx, armed },
        effects: armed && !s.armed ? ['buzz'] : [],
      };
    }
    case 'up':
      // Lifted before the hold: the click that follows is the tap.
      if (s.kind === 'pressing') return { next: IDLE, effects: [] };
      if (s.kind !== 'held') return stay;
      if (s.armed) return { next: { kind: 'spent' }, effects: ['discard'] };
      // Still waiting on the microphone (its prompt took the moment): keep
      // what is coming and let him finish with the buttons.
      if (!e.live) return { next: IDLE, effects: [] };
      return { next: { kind: 'spent' }, effects: ['send'] };
    case 'lost':
      // Before the hold nothing started; after it the recording carries on,
      // hands-free.
      if (s.kind === 'pressing' || s.kind === 'held') return { next: IDLE, effects: [] };
      return stay;
    case 'click':
      if (s.kind === 'spent') return { next: IDLE, effects: [] };
      if (s.kind === 'idle') return { next: IDLE, effects: ['start'] };
      return stay;
  }
}

/** How close the finger is to throwing it away, 0 to 1: the row's `--slide`. */
export function slideOf(s: Hold): number {
  if (s.kind !== 'held') return 0;
  return Math.min(1, Math.max(0, -s.dx / CANCEL_PX));
}
