/**
 * Where a dad was when he last looked.
 *
 * Per device and per group, in localStorage beside the theme and the
 * language: a laptop and a phone are two places he reads from, and each
 * remembers its own. The value is the room's `seq` of the newest line that
 * was on his screen while he was at the bottom and the tab was showing —
 * which is what "seen" means here, and nothing more precise is possible or
 * needed.
 *
 * Nothing is sent. Whether a dad has read a line is his business; this only
 * exists so that when he comes back the room can say "from here on is new".
 */

const KEY = 'dads.seen.';

export function lastSeen(groupId: string): number | null {
  try {
    const raw = localStorage.getItem(KEY + groupId);
    if (raw === null) return null;
    const seq = Number(raw);
    return Number.isFinite(seq) && seq > 0 ? seq : null;
  } catch {
    return null;
  }
}

export function markSeen(groupId: string, seq: number): void {
  try {
    if (seq > (lastSeen(groupId) ?? 0)) localStorage.setItem(KEY + groupId, String(seq));
  } catch {
    // Storage refused. He will not get the divider on this device; the room
    // still works.
  }
}
