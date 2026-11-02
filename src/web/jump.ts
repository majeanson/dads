/**
 * The way back down to the newest line, and which of its two looks it wears.
 *
 * Marc asked (2026-11-02) for a way down from far up the week even when
 * nothing new has come in. The "N new" pill already took him down when there
 * was something to go down to; with nothing new he had to thumb all the way
 * back. Pure so the worker pool can test it.
 */

/** The list's three numbers, as the DOM gives them. */
export interface Scrolled {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/**
 * More than a screen's height above the bottom.
 *
 * A screen and not a fixed distance: within one, the newest line is a flick
 * away and a button would only sit on top of the conversation.
 */
export function isFarUp({ scrollHeight, scrollTop, clientHeight }: Scrolled): boolean {
  if (clientHeight <= 0) return false;
  return scrollHeight - scrollTop - clientHeight > clientHeight;
}

/**
 * Nothing, the count, or the bare arrow.
 *
 * At the bottom there is nowhere to go. Anything new and he is not at the
 * bottom: the count, which is the more useful of the two things it could say.
 * Otherwise the arrow, only from far up.
 */
export function jumpLook({
  pinned,
  unseen,
  farUp,
}: {
  pinned: boolean;
  unseen: number;
  farUp: boolean;
}): 'none' | 'count' | 'arrow' {
  if (pinned) return 'none';
  if (unseen > 0) return 'count';
  return farUp ? 'arrow' : 'none';
}
