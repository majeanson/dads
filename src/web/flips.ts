/**
 * Switches that answer the finger and still follow the room.
 *
 * Settings used to copy the room's three switches into state once, when the
 * sheet opened, and flip that copy. Optimistic, which is right — but a
 * creator flipping one on his other phone while this sheet was open left it
 * showing the old value until it was closed and opened again (2026-11-02).
 *
 * So the sheet keeps only its own flips, on top of what the room says. A flip
 * stands until the room says the same thing (the socket's `rooms` frame, which
 * may come before or after the PUT's answer — waiting for the answer and then
 * dropping the flip would show the old value for the gap), and is dropped at
 * once if the PUT fails. Everything not flipped here is the room's.
 */

import type { RoomsOpen } from '../shared/protocol';

/** The switches flipped on this screen and not yet confirmed by the room. */
export type Flips = Partial<RoomsOpen>;

/** What to show: the room's switches, with this screen's flips on top. */
export function shownSwitches(room: RoomsOpen, flips: Flips): RoomsOpen {
  return { ...room, ...flips };
}

/** The flips the room has not caught up with yet. The same object when
 * nothing changed, so a state setter can skip the render. */
export function settleFlips(room: RoomsOpen, flips: Flips): Flips {
  const left: Flips = {};
  let dropped = false;
  for (const key of Object.keys(flips) as (keyof RoomsOpen)[]) {
    if (flips[key] === room[key]) dropped = true;
    else left[key] = flips[key];
  }
  return dropped ? left : flips;
}

/** A flip that failed: that one goes, the room's value shows again. */
export function withoutFlip(flips: Flips, key: keyof RoomsOpen): Flips {
  const left = { ...flips };
  delete left[key];
  return left;
}
