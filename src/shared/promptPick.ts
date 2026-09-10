/**
 * Which question a group gets on a given day.
 *
 * Deterministic on purpose: the same group on the same day gets the same
 * question from any server, with no coordination and no stored state needed to
 * compute it. (It is stored anyway — see prompt_days — because the pool grows
 * when a dad adds one, and yesterday's question must not silently change
 * underneath the answers already attached to it.)
 *
 * Keyed on the group as well as the day so two groups do not march through the
 * library in lockstep.
 */

/** FNV-1a, 32-bit. Small, fast, no crypto, and stable across engines. */
export function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    // The FNV prime, via shifts, staying inside 32 bits.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * @param poolSize how many active prompts the group can draw from
 * @returns the index to use, or null when there is nothing to ask
 */
export function pickIndex(groupId: string, day: string, poolSize: number): number | null {
  if (poolSize <= 0) return null;
  return hashKey(`${groupId}:${day}`) % poolSize;
}
