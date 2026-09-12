/**
 * Where a dad got to, per device.
 *
 * The mark that everything about "how many are new" is derived from. It is
 * per device and per group, beside the theme and the language: a laptop and a
 * phone are two places he reads from and each remembers its own. Nothing is
 * sent — whether a man has read a line is his business; this only exists so
 * the room can say "from here on is new" when he comes back.
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
    // Storage refused. He loses the divider on this device; the room works.
  }
}
