/**
 * Where a dad got to, this device's copy.
 *
 * The mark that everything about "how many are new" is derived from. Since
 * 2026-11-02 it is ONE mark per dad, kept on his member row by the room, so
 * reading on the laptop clears the phone (Marc asked). This file is the local
 * copy of it, per group: what the screen counts from before the socket has
 * said hello, and all there is when storage or the socket is refused. The two
 * meet in `reconcile`, which takes whichever got further. Nobody but him is
 * ever told — whether a man has read a line is his business.
 *
 * Storage is reached through a locally-typed accessor rather than the DOM
 * global, so this file and its test typecheck in the worker pool with the
 * rest of the pure logic. It is also the honest shape: every call already has
 * to survive storage being absent or refusing.
 */

const KEY = 'dads.seen.';

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function store(): Store | null {
  return (globalThis as { localStorage?: Store }).localStorage ?? null;
}

/** The last line he looked at in this group, or null if this device has none. */
export function lastSeen(groupId: string): number | null {
  try {
    const raw = store()?.getItem(KEY + groupId) ?? null;
    if (raw === null) return null;
    const seq = Number(raw);
    return Number.isFinite(seq) && seq > 0 ? seq : null;
  } catch {
    // A private window, blocked site data, a browser mid-eviction.
    return null;
  }
}

/**
 * Move the mark forward. NEVER backwards.
 *
 * A backfill that arrives out of order, or a second tab further back in the
 * conversation, must not make lines he has already read new again — which is
 * the bug this whole mark replaced, in a different form.
 */
export function markSeen(groupId: string, seq: number): void {
  try {
    if (seq > (lastSeen(groupId) ?? 0)) store()?.setItem(KEY + groupId, String(seq));
  } catch {
    // Storage refused. The room still keeps his mark; this device only loses
    // its copy for the seconds before the socket says hello.
  }
}

/**
 * This device's mark and the room's, as one: whichever got further.
 *
 * Both only ever move forward, so the further one is the truth — he read that
 * far on one of his devices — and the other is merely behind. Null is "never
 * marked here" (or "the room does not know yet"), which is no answer rather
 * than nought: two nulls stay null, so a device new to a dad who is new to the
 * room still starts at the newest line, not at the beginning of the archive.
 */
export function reconcile(local: number | null, remote: number | null): number | null {
  if (local === null) return remote;
  if (remote === null) return local;
  return Math.max(local, remote);
}
