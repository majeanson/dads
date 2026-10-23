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
 * The questions a brand-new room may open with.
 *
 * The first thing a stranger is asked should be one anybody can answer. The
 * library is honest about hard things — a father who was absent, a kid who is
 * struggling, a failure — and a room's first day is not the day for them: a
 * man who has just opened the app should not meet "What did your father get
 * right?" before he has met his friends. These are the lighter ones; the rest
 * of the library comes once the room has had a day of its own. Ids, not
 * bodies, because a body can be re-worded in a migration and an id cannot.
 */
export const OPENERS: ReadonlySet<string> = new Set([
  'prm_0027', // what did you do together this week, for no purpose
  'prm_0028', // the first five minutes when you get home
  'prm_0029', // a small ritual with your kid
  'prm_0030', // bored together on purpose
  'prm_0071', // what your kid is into that you don't understand
  'prm_0072', // what your kid does better than you
  'prm_0074', // what you love about your kid that has nothing to do with you
  'prm_0087', // when you last felt you got it right
  'prm_0090', // what fatherhood gave you that you didn't expect
  'prm_0094', // what's working right now
  'prm_0095', // what you got better at this year
  'prm_0098', // what you'd tell a new dad
]);

/**
 * @param poolSize how many active prompts the group can draw from
 * @returns the index to use, or null when there is nothing to ask
 */
export function pickIndex(groupId: string, day: string, poolSize: number): number | null {
  if (poolSize <= 0) return null;
  return hashKey(`${groupId}:${day}`) % poolSize;
}
