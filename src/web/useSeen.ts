import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { RoomMessage } from '../shared/protocol';
import { isFarUp } from './jump';
import { lastSeen, markSeen, reconcile } from './seen';
import { useVisualViewport } from './useVisualViewport';

/** Close enough to the newest line to count as reading it. */
const NEAR_BOTTOM_PX = 80;

/** Hidden for longer than this and coming back counts as coming back. */
const AWAY_MS = 30 * 60_000;

/** A mark goes to the room at most this often while he reads; the newest one
 * at the end of each wait, and at once when the page is put away. */
const SHARE_EVERY_MS = 1_000;

export interface Seen {
  /** How many lines he has not looked at. Derived, never accumulated. */
  unseen: number;
  /** The last line he saw before this sitting, or null on a first visit. */
  since: number | null;
  /** Reading the newest line, rather than back through the week. */
  pinned: boolean;
  /** More than a screen above the newest line: far enough that a way back
   * down is worth a button even with nothing new below (`jump.ts`). */
  farUp: boolean;
  /** The list scrolled: work out whether he is still at the bottom. */
  onScroll: () => void;
  /** Down to the newest line, which is also reading everything above it. */
  toBottom: () => void;
  /** He sent a line: straight to the bottom, and pinned so it lands in sight. */
  sent: () => void;
  /** Not pinned any more — he is reading from somewhere else in the list. */
  unpin: () => void;
}

/**
 * What he has read, and where the list is.
 *
 * Two halves, because they are two jobs:
 *
 *  - `useSeenMark` (below) is the MARK: the newest line he has looked at, on
 *    any of his devices. Everything about "how many are new" — the count, the
 *    divider, the tab's title, the icon's badge — is derived from it, never
 *    tallied. It knows nothing about scrolling.
 *  - this hook is the LIST: whether he is at the bottom, following new lines
 *    down, the way back down from far up. It tells the mark when he has read
 *    something, which is being at the bottom of the conversation with the
 *    page showing.
 *
 * `watching` is the list's whole guard: home and the conversation are two
 * views of one component and the stage is hidden with CSS rather than
 * unmounted, so every effect in here would otherwise fire while a dad is
 * standing on home, where it can neither see nor scroll anything.
 */
export function useSeen({
  groupId,
  groupName,
  messages,
  view,
  watching,
  ready,
  remote,
  share,
  bottom,
  lines,
}: {
  groupId: string;
  groupName: string;
  messages: RoomMessage[];
  view: 'home' | 'talk';
  /** The conversation is genuinely on the screen — not home, not the table. */
  watching: boolean;
  /** The room has said hello, so `messages` is the backfill and not merely
   * nothing yet. What tells an empty room apart from one still loading. */
  ready: boolean;
  /** His mark as the room last said (`useRoom`'s `seen`). */
  remote: number | null;
  /** Tell the room how far he has read (`useRoom`'s `sendSeen`). */
  share: (seq: number) => void;
  bottom: RefObject<HTMLLIElement | null>;
  lines: RefObject<HTMLOListElement | null>;
}): Seen {
  const { unseen, since, read } = useSeenMark({
    groupId,
    groupName,
    messages,
    ready,
    remote,
    share,
  });

  const [pinned, setPinned] = useState(true);
  const [farUp, setFarUp] = useState(false);
  /** The page is showing. State rather than a read of `document.hidden`, so
   * coming back to the tab re-runs the effect that counts it as reading. */
  const [shown, setShown] = useState(() => !document.hidden);
  /** Where the list was at the last scroll, to tell down from up. */
  const lastTop = useRef(0);
  /**
   * On the way down after a press of the button.
   *
   * A smooth scroll passes through every position between, and each of them
   * reads as "he is up the list": the button came back for the length of the
   * ride and the count flickered. While this is set, a scroll that went DOWN is
   * the ride and changes nothing; one that went up is his thumb, and ends it.
   */
  const descending = useRef(false);

  const lastSeq = messages.at(-1)?.seq ?? 0;

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
    // `view`, not `watching`: beside an open table the list is still on the
    // screen, and the line he just sent has to land there too.
    if (view === 'talk' && pinned) bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, view, pinned, bottom]);

  /**
   * Going in is reading it, and so is scrolling to the newest line — with the
   * page showing. The mark only moves forward, so telling it again is free.
   */
  useEffect(() => {
    if (watching && pinned && shown) read(lastSeq);
  }, [watching, pinned, shown, lastSeq, read]);

  /** Straight to the bottom, and everything down to there is read. */
  useEffect(() => {
    if (view !== 'talk' || !pinnedNow.current) return;
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [view, bottom]);

  /**
   * At the bottom stays at the bottom, whatever grows.
   *
   * The scroll above happens when a line ARRIVES, and a line is not finished
   * arriving: its reactions are drawn under it, a photograph loads into the
   * space it was given, a quote settles. Each of those makes the list taller
   * after he was already scrolled to the end, so he landed a few lines short
   * with the newest line's reactions off the bottom of the screen — and
   * scrolling by hand "fixed" it. Watching the rows' own sizes, and pictures
   * loading, keeps a dad who is at the bottom there. A dad who has scrolled
   * up is not pinned and is never moved.
   */
  useEffect(() => {
    const list = lines.current;
    if (!watching || list === null || typeof ResizeObserver === 'undefined') return;
    // Was he at the end BEFORE this growth? Measured against how far the list
    // could scroll last time, not now: a row that has just got taller has
    // already moved the end away from him. Read from the scroll position itself
    // rather than from `pinned`, which catches up a render later — a dad who
    // scrolled up in the same frame a row grew must not be taken back down.
    let before = list.scrollHeight - list.clientHeight;
    const stick = () => {
      const wasAtEnd = list.scrollTop >= before - NEAR_BOTTOM_PX;
      if (pinnedNow.current && wasAtEnd) list.scrollTop = list.scrollHeight;
      before = list.scrollHeight - list.clientHeight;
      // A row growing or going (a line taken back, a picture loading) moves
      // the bottom without a scroll; "far up" is re-read here rather than with
      // an observer of its own.
      setFarUp(isFarUp(list));
    };
    const sizes = new ResizeObserver(stick);
    const rows = (parent: ParentNode) => parent.querySelectorAll(':scope > li');
    // The border box: anything that makes a row taller counts, padding included.
    const watch = (row: Element) => sizes.observe(row, { box: 'border-box' });
    rows(list).forEach(watch);
    const arrivals = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLLIElement) watch(node);
        });
      }
    });
    arrivals.observe(list, { childList: true });
    // `load` does not bubble, but it can be caught on the way down.
    list.addEventListener('load', stick, true);
    stick();
    return () => {
      sizes.disconnect();
      arrivals.disconnect();
      list.removeEventListener('load', stick, true);
    };
  }, [watching, lines]);

  /** A dad who has scrolled up, or looked away, has not seen it. */
  const atBottom = useCallback(() => {
    const el = lines.current;
    if (el === null) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, [lines]);

  // Reaching the newest line is reading everything down to it — but that is
  // the reading effect's job, which fires as soon as `pinned` flips.
  // Smooth, unless he has asked the phone for no motion; then it is a jump.
  const rideOver = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toBottom = useCallback(() => {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    descending.current = !still;
    // A ride that never reaches the bottom (a picture loading under it moved
    // the end away) must not be a ride for ever: after it has had its time,
    // his own scrolls count again.
    clearTimeout(rideOver.current);
    rideOver.current = setTimeout(() => {
      descending.current = false;
    }, 1_500);
    bottom.current?.scrollIntoView({ block: 'end', behavior: still ? 'auto' : 'smooth' });
    setPinned(true);
  }, [bottom]);
  useEffect(() => () => clearTimeout(rideOver.current), []);

  /**
   * He sent something: wherever he was reading, his own line is what he wants
   * to see next (Marc, 2026-11-01). Straight down, not smoothly — a smooth
   * scroll passes through spots the list reads as "he scrolled up" and the
   * line that comes back would then wait below the fold — and pinned, so the
   * echo follows when it lands.
   */
  const sent = useCallback(() => {
    descending.current = false;
    bottom.current?.scrollIntoView({ block: 'end' });
    setPinned(true);
  }, [bottom]);

  const onScroll = useCallback(() => {
    const el = lines.current;
    if (el === null) return;
    const wentUp = el.scrollTop < lastTop.current;
    lastTop.current = el.scrollTop;
    setFarUp(isFarUp(el));
    const end = atBottom();
    if (descending.current) {
      if (!end && !wentUp) return;
      descending.current = false;
    }
    setPinned(end);
  }, [atBottom, lines]);
  const unpin = useCallback(() => {
    descending.current = false;
    setPinned(false);
  }, []);

  // The keyboard coming up takes a third of the list. If he was reading the
  // newest line, he still is. And the screen just changed height, which is
  // what "far" is measured in, without the list necessarily scrolling.
  const keepBottom = useCallback(() => {
    if (pinned) bottom.current?.scrollIntoView({ block: 'end' });
    const el = lines.current;
    if (el !== null) setFarUp(isFarUp(el));
  }, [pinned, bottom, lines]);
  useVisualViewport(keepBottom);

  // Coming back to the tab is seeing it, if he is still at the bottom: the
  // reading effect runs again because `shown` changed.
  useEffect(() => {
    function look() {
      setShown(!document.hidden);
      if (!document.hidden && atBottom()) setPinned(true);
    }
    document.addEventListener('visibilitychange', look);
    return () => document.removeEventListener('visibilitychange', look);
  }, [atBottom]);

  return { unseen, since, pinned, farUp, onScroll, toBottom, sent, unpin };
}

/**
 * The mark: the newest line he has looked at, on ANY of his devices.
 *
 * One mark per dad, not per phone (Marc asked, 2026-11-02). Two sources, one
 * answer: this device's own copy in localStorage (`seen.ts`), which is what
 * there is before the socket says hello and all there is when it cannot, and
 * the room's, which arrives in `hello` and again whenever his other device
 * reads further. The mark is whichever got further (`reconcile`); neither
 * ever goes backwards. When he reads here, the copy is written at once and
 * the room is told at most once a second (`share`), and at once when the page
 * is put away, so the other phone's count drops while he is still reading.
 *
 * Nobody else is told — whether a man has read a line is his business. The
 * room relays his mark only to his own sockets.
 */
export function useSeenMark({
  groupId,
  groupName,
  messages,
  ready,
  remote,
  share,
}: {
  groupId: string;
  groupName: string;
  messages: RoomMessage[];
  ready: boolean;
  remote: number | null;
  share: (seq: number) => void;
}): { unseen: number; since: number | null; read: (seq: number) => void } {
  /** What this device has read, or null if it has never opened this room. */
  const [local, setLocal] = useState<number | null>(() => lastSeen(groupId));
  const mark = reconcile(local, remote);
  const markNow = useRef(mark);
  markNow.current = mark;

  const lastSeq = messages.at(-1)?.seq ?? 0;
  const unseen = mark === null ? 0 : messages.reduce((n, m) => (m.seq > mark ? n + 1 : n), 0);

  // --- telling the room, at most once a second -----------------------------

  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) share(pending.current);
    pending.current = null;
  }, [share]);

  /** He has looked at everything up to `seq` on this device. */
  const read = useCallback(
    (seq: number) => {
      if (seq <= 0 || (markNow.current !== null && seq <= markNow.current)) return;
      setLocal((had) => (had !== null && had >= seq ? had : seq));
      markSeen(groupId, seq);
      pending.current = Math.max(pending.current ?? 0, seq);
      timer.current ??= setTimeout(flush, SHARE_EVERY_MS);
    },
    [groupId, flush],
  );

  // Put away is the last chance: a phone locked mid-read must not leave the
  // other one counting what he just read. And unmounting sends what is held.
  useEffect(() => {
    const away = () => {
      if (document.hidden) flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', away);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', away);
      flush();
    };
  }, [flush]);

  // What this device already had goes to the room too, once: a phone that
  // read further before the room kept marks (or offline) says so. `useRoom`
  // holds it until the socket opens, and the room ignores it if it is behind.
  useEffect(() => {
    const had = lastSeen(groupId);
    if (had !== null) share(had);
  }, [groupId, share]);

  // His other device read further: this device's copy catches up, so a
  // reload before the socket is back does not count those lines again.
  useEffect(() => {
    if (remote !== null) markSeen(groupId, remote);
  }, [remote, groupId]);

  // A dad who has never opened this room on ANY device has nothing to catch
  // up on: the archive is not a backlog. The mark starts at the newest line
  // he was handed rather than at nothing. (A new phone of a dad who has read
  // here before starts where he got to: the room's mark is not null.)
  //
  // And in a room where nothing has been said, it starts at nought ONCE the
  // room has said hello — not at the first line to arrive. Waiting for a line
  // to anchor to made that line the mark, so the first thing ever said in a
  // group was the one thing the door never counted.
  useEffect(() => {
    if (mark !== null) return;
    if (lastSeq > 0) read(lastSeq);
    else if (ready) setLocal(0);
  }, [mark, lastSeq, ready, read]);

  // --- the divider -----------------------------------------------------------

  /**
   * Where "new since you were here" goes: the mark as it was when this sitting
   * began. Set when the screen opens and when he comes back after AWAY_MS,
   * and settled against the room's mark the next time the room speaks, so it
   * means since he was here on ANY of his devices — not since this phone
   * last looked. It does not follow him while he reads.
   */
  const [since, setSince] = useState<number | null>(() => lastSeen(groupId));
  const settling = useRef(true);
  useEffect(() => {
    if (!ready || !settling.current) return;
    settling.current = false;
    setSince((s) => reconcile(s, remote));
  }, [ready, remote]);

  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    function back() {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current !== null && Date.now() - hiddenAt.current > AWAY_MS;
      hiddenAt.current = null;
      if (!away) return;
      // The socket has usually dropped while the phone slept, and the room's
      // word on how far he got arrives with the hello that follows.
      setSince(markNow.current);
      settling.current = true;
    }
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  // --- what the count is shown on --------------------------------------------

  /**
   * The tab's own title carries the count while you are looking elsewhere.
   *
   * No permission, no prompt, no service worker: the one signal a browser will
   * give you for free, and the only one that suits a room five men use.
   */
  useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) ${groupName}` : groupName;
  }, [groupName, unseen]);

  /**
   * The same count on the home-screen icon, where the browser has one.
   *
   * On the first render too (`unseen` is 0 until the backfill), which is what
   * replaces the service worker's unnumbered dot with the truth when the app
   * opens. Absent API, or a refusal, is not a fault.
   */
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const done = unseen > 0 ? nav.setAppBadge?.(unseen) : nav.clearAppBadge?.();
    done?.catch(() => {});
  }, [unseen]);

  return { unseen, since, read };
}
