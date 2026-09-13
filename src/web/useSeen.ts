import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { RoomMessage } from '../shared/protocol';
import { lastSeen, markSeen } from './seen';
import { useVisualViewport } from './useVisualViewport';

/** Close enough to the newest line to count as reading it. */
const NEAR_BOTTOM_PX = 80;

/** Hidden for longer than this and coming back counts as coming back. */
const AWAY_MS = 30 * 60_000;

export interface Seen {
  /** How many lines he has not looked at. Derived, never accumulated. */
  unseen: number;
  /** The last line he saw before this sitting, or null on a first visit. */
  since: number | null;
  /** Reading the newest line, rather than back through the week. */
  pinned: boolean;
  /** The list scrolled: work out whether he is still at the bottom. */
  onScroll: () => void;
  /** Down to the newest line, which is also reading everything above it. */
  toBottom: () => void;
  /** Not pinned any more — he is reading from somewhere else in the list. */
  unpin: () => void;
}

/**
 * What he has read, and where the list is.
 *
 * One hook because it is one question asked three ways: how many lines are
 * new, whether a new one should scroll the page, and whether the tab's title
 * should say anything. All three are answered from ONE mark — the newest seq
 * he actually looked at, kept per device in localStorage — rather than from a
 * tally. The tally this replaced began every load at nought, so every
 * backfilled line incremented it and opening the app on a conversation he had
 * already read announced forty-one new ones.
 *
 * Nothing here is sent anywhere. Whether a man has read a line is his
 * business, so it lives beside the theme and never leaves the browser.
 *
 * `watching` is the whole guard: home and the conversation are two views of
 * one component and the stage is hidden with CSS rather than unmounted, so
 * every effect in here would otherwise fire while a dad is standing on home,
 * where it can neither see nor scroll anything.
 */
export function useSeen({
  groupId,
  groupName,
  messages,
  view,
  watching,
  bottom,
  lines,
}: {
  groupId: string;
  groupName: string;
  messages: RoomMessage[];
  view: 'home' | 'talk';
  /** The conversation is genuinely on the screen — not home, not the table. */
  watching: boolean;
  bottom: RefObject<HTMLLIElement | null>;
  lines: RefObject<HTMLOListElement | null>;
}): Seen {
  const [pinned, setPinned] = useState(true);
  /**
   * The newest line he has actually looked at, on this device.
   *
   * Null until the first backfill lands, which is a dad who has never opened
   * this room here.
   */
  const [seenSeq, setSeenSeq] = useState<number | null>(() => lastSeen(groupId));
  const [since, setSince] = useState<number | null>(() => lastSeen(groupId));

  const lastSeq = messages.at(-1)?.seq ?? 0;
  const unseen = seenSeq === null ? 0 : messages.reduce((n, m) => (m.seq > seenSeq ? n + 1 : n), 0);

  const pinnedNow = useRef(pinned);
  pinnedNow.current = pinned;

  /**
   * New lines follow him down only if he was already at the bottom.
   *
   * Scrolling to the newest message on every arrival is right until a dad is
   * reading back through last Thursday, at which point it snatches the page
   * out of his hands every time somebody types. If he is up there, the line
   * waits and the room says how many.
   */
  const counted = useRef(0);
  useEffect(() => {
    const count = messages.length;
    // Only a new line does anything here. `pinned` is read by the effect, but
    // a dad scrolling must never itself cause a scroll or count as an arrival.
    if (count === counted.current) return;
    counted.current = count;
    if (watching && pinned) bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, watching, pinned, bottom]);

  /**
   * Going in is reading it, and so is scrolling to the newest line.
   *
   * Advancing the mark rather than zeroing a tally. What he has seen is a
   * property of him and this device, it survives the tab, and the count is
   * derived from it.
   */
  useEffect(() => {
    if (!watching || !pinned || document.hidden) return;
    if (lastSeq <= 0 || (seenSeq !== null && lastSeq <= seenSeq)) return;
    setSeenSeq(lastSeq);
    markSeen(groupId, lastSeq);
  }, [watching, pinned, lastSeq, seenSeq, groupId]);

  // A dad who has never opened this room on this device has nothing to catch
  // up on: the archive is not a backlog. The mark starts at the newest line
  // he was handed rather than at nothing.
  useEffect(() => {
    if (seenSeq === null && lastSeq > 0) {
      setSeenSeq(lastSeq);
      markSeen(groupId, lastSeq);
    }
  }, [seenSeq, lastSeq, groupId]);

  /** Straight to the bottom, and everything down to there is read. */
  useEffect(() => {
    if (view !== 'talk' || !pinnedNow.current) return;
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [view, bottom]);

  /** A dad who has scrolled up, or looked away, has not seen it. */
  const atBottom = useCallback(() => {
    const el = lines.current;
    if (el === null) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, [lines]);

  // Reaching the newest line is reading everything down to it — but that is
  // the mark-advancing effect's job, which fires as soon as `pinned` flips.
  const toBottom = useCallback(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    setPinned(true);
  }, [bottom]);

  const onScroll = useCallback(() => setPinned(atBottom()), [atBottom]);
  const unpin = useCallback(() => setPinned(false), []);

  // The keyboard coming up takes a third of the list. If he was reading the
  // newest line, he still is.
  const keepBottom = useCallback(() => {
    if (pinned) bottom.current?.scrollIntoView({ block: 'end' });
  }, [pinned, bottom]);
  useVisualViewport(keepBottom);

  // Coming back to the tab is seeing it. Coming back after long enough is
  // coming back: the last line he saw becomes the boundary, and the divider
  // below points at everything since.
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    function seen() {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current !== null && Date.now() - hiddenAt.current > AWAY_MS;
      hiddenAt.current = null;
      // Coming back is reading it; the mark-advancing effect picks it up on
      // the next render, because the tab is no longer hidden.
      if (away) setSince(lastSeen(groupId));
      else if (atBottom()) setPinned(true);
    }
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [atBottom, groupId]);

  // Looking at the newest line, with the tab showing, is having seen it.
  useEffect(() => {
    if (pinned && unseen === 0 && !document.hidden && lastSeq > 0) {
      markSeen(groupId, lastSeq);
    }
  }, [pinned, unseen, lastSeq, groupId]);

  /**
   * The tab's own title carries the count while you are looking elsewhere.
   *
   * No permission, no prompt, no service worker: the one signal a browser will
   * give you for free, and the only one that suits a room five men use.
   */
  useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) ${groupName}` : groupName;
  }, [groupName, unseen]);

  return { unseen, since, pinned, onScroll, toBottom, unpin };
}
