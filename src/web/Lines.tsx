import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Attachment as MessageAttachment, RoomMessage } from '../shared/protocol';
import { parts, shortLink } from '../shared/linkify';
import { splitMentions } from '../shared/mentions';
import { describeSaid } from '../shared/said';
import { Attachment } from './Attachment';
import { Reply } from 'lucide-react';
import { buzz } from './buzz';
import { Face } from './Face';
import { SWIPE_ARM_PX, swipeEnd, swipeMove, swipeStart, type Swipe } from './swipe';
import { LinkPreviewCard } from './LinkCard';
import { dadVar } from './dadColour';
import { useT } from './i18n';
import { Logo } from './Logo';
import { useMemberNamed, useMembers } from './members';
import { Marks, marksOf, QuickMark } from './Marks';
import type { Row } from './messageGroups';
import { LineMenu, menuOpen, notATap } from './ui/LineMenu';

/** The first link in a line, which is the one that gets a card. */
function firstLink(body: string): string | null {
  const found = parts(body).find((part) => part.link);
  return found !== undefined && found.link ? found.href : null;
}

/** The lines a key moves between: what a dad typed, never the room's own. */
const TYPED = 'li.line-chat, li.line-prompt';

/**
 * The first thing Tab would reach after the list, or the last one before it.
 * Inert, hidden and disabled things are not reachable, and neither is
 * anything inside the list: that is the point.
 */
function beyond(list: HTMLElement, back: boolean): HTMLElement | undefined {
  const all = [
    ...document.querySelectorAll<HTMLElement>(
      'a[href], button, input, textarea, select, [tabindex]',
    ),
  ].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !list.contains(el) &&
      !el.matches(':disabled') &&
      el.closest('[inert]') === null &&
      el.getClientRects().length > 0,
  );
  const side = back ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  const there = all.filter((el) => (list.compareDocumentPosition(el) & side) !== 0);
  return back ? there.at(-1) : there[0];
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The conversation itself.
 *
 * Dumb on purpose: `messageGroups` has already decided what a row is — which
 * lines drop the repeated name, where a day opens, where "new since you were
 * here" goes — and this only draws them. Every cell is placed by hand in CSS
 * because auto-placement counts children rather than columns, and on a
 * continued line with no face in the gutter the words slid one column left.
 */
export function Lines({
  rows,
  empty,
  you,
  lines,
  bottom,
  newMark,
  nameOf,
  onReact,
  onRetract,
  onReply,
  onEdit,
  onAway,
  onKeep,
  onOpenPhoto,
  onOpenProfile,
  onTapAway,
  onArrived,
  onScroll,
}: {
  rows: Row[];
  /** Nothing has been said in this room at all. */
  empty: boolean;
  /** The reader's own member id, for "which marks are mine". */
  you: string;
  lines: RefObject<HTMLOListElement | null>;
  bottom: RefObject<HTMLLIElement | null>;
  /** The "new since you were here" divider, so the list can land on it. */
  newMark: RefObject<HTMLLIElement | null>;
  nameOf: (memberId: string) => string;
  onReact: (id: string, emoji: string, on: boolean) => void;
  onRetract: (id: string) => void;
  onReply: (message: RoomMessage) => void;
  onEdit: (message: RoomMessage) => void;
  /** The composer takes the focus once the line menu has closed. */
  onAway: () => void;
  onKeep: (media: MessageAttachment) => void;
  onOpenPhoto: (mediaId: string) => void;
  /** A name or a face on a line: that dad's profile. */
  onOpenProfile: (memberId: string) => void;
  /** On a phone, a tap on nothing in the conversation: put the keyboard away. */
  onTapAway: () => void;
  /**
   * A dad's line arrived while the list was settled — not the backfill, not
   * his own. Absent while the conversation is not on the screen; the lines
   * that arrive then are passed over, not saved up.
   */
  onArrived?: (message: RoomMessage) => void;
  onScroll: () => void;
}) {
  const { t, lang } = useT();

  /**
   * The seq the list had when it first settled. Lines after it ARRIVED while
   * he was here and ease in; the backfill does not, because five hundred
   * lines rising at once on opening the app is noise, not an arrival.
   */
  const settled = useRef<number | null>(null);
  const newest = rows.reduce((n, r) => (r.kind === 'message' ? Math.max(n, r.key) : n), 0);
  useEffect(() => {
    if (settled.current === null && (rows.length > 0 || empty)) settled.current = newest;
  }, [rows.length, empty, newest]);
  const arrived = (seq: number) => settled.current !== null && seq > settled.current;

  /**
   * Telling a screen reader a line arrived (`announce.ts`, the log in `Room`).
   *
   * From the same boundary the easing uses, so the backfill is never read
   * out; `heard` is the newest seq already passed over, so each line is told
   * once however often the rows are rebuilt (a mark, an edit, a picture kept).
   */
  const heard = useRef<number | null>(null);
  const tell = useRef(onArrived);
  useEffect(() => {
    tell.current = onArrived;
  }, [onArrived]);
  useEffect(() => {
    if (settled.current === null) return;
    const from = heard.current ?? settled.current;
    heard.current = Math.max(from, newest);
    if (newest <= from || tell.current === undefined) return;
    for (const row of rows) {
      if (row.kind !== 'message' || row.key <= from) continue;
      const m = row.message;
      if ((m.kind === 'chat' || m.kind === 'prompt') && m.memberId !== you) tell.current(m);
    }
  }, [rows, newest, you]);

  /**
   * Whether the pointer is a thumb. On a phone the long press is the menu
   * (marks in it) and the swipe is the reply; a tap on the words is nothing.
   * A row of marks used to open on a tap (2026-10 to 2026-11-01) and Marc
   * asked for it to go: a tap is what a thumb does by accident. On a laptop a
   * click selects text and the double click is a thumb.
   */
  const [coarse] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true,
  );
  /** The press in progress: when it began, and whether a menu was open. */
  const press = useRef({ at: 0, whileOpen: false });
  /** Who "@Sam" could be: everyone the room knows, the departed included,
   * so a line that named a man last month still names him. */
  const members = useMembers();
  const people = members.map((m) => ({ id: m.memberId, name: m.name }));
  /** Who still has a profile to open: a dad who has left is a 404. */
  const inRoom = new Set(members.filter((m) => m.gone !== true).map((m) => m.memberId));

  /**
   * Whether the focus about to land came from a press rather than a key.
   * A click on the list's empty space focuses the list, and moving him to
   * the newest line for that would scroll away from what he clicked.
   */
  const pointing = useRef(false);

  /**
   * Whether the focus about to land came from Shift+Tab. Coming back up from
   * the composer, the browser walks into the list from its END — the last
   * mark or link of the newest line — rather than onto the list, which comes
   * before its children. That Tab is sent to the newest line instead, as a
   * Tab from above is (2026-11-02). Only that key: a menu or a sheet closing
   * puts the focus back on a control inside the list, and that is where it
   * belongs. The flag lives for the one task the key's own focus move is in.
   */
  const backTab = useRef(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !event.shiftKey) return;
      backTab.current = true;
      setTimeout(() => (backTab.current = false), 0);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /**
   * On a phone, a swipe to the right on a line is a reply (`swipe.ts`).
   *
   * The line follows the thumb, and buzzes once where lifting would answer.
   * The DOM is moved by hand (`translate`, one element) rather than through
   * state: a render of the list for every pixel of a thumb is a stutter. The
   * click the lift becomes is swallowed, like the one after a long press.
   */
  const swipe = useRef<{ s: Swipe; el: HTMLLIElement; id: number } | null>(null);
  const swiped = useRef(false);
  const settle = (el: HTMLLIElement) => {
    el.style.transition = '';
    el.style.translate = '';
    el.style.removeProperty('--swipe');
    el.removeAttribute('data-swiping');
  };
  const endSwipe = () => {
    const live = swipe.current;
    swipe.current = null;
    if (live === null) return false;
    if (live.el.hasPointerCapture(live.id)) live.el.releasePointerCapture(live.id);
    settle(live.el);
    return swipeEnd(live.s);
  };

  /** The lines a key moves between: what a dad typed, oldest first. */
  const reachable = () => [...(lines.current?.querySelectorAll<HTMLElement>(TYPED) ?? [])];

  return (
    <ol
      className="lines"
      aria-label={t('room.messages')}
      ref={lines}
      onScroll={onScroll}
      // One Tab stop for the whole conversation, and the arrows inside it
      // (Marc asked for a keyboard way to a line's menu, 2026-11-01). The
      // list takes the Tab and hands it straight to the newest line.
      tabIndex={0}
      onMouseDown={(event) => {
        // On a phone a tap in the list moves no focus: the lines are
        // focusable now, and WebKit hands the focus of a tapped mark or photo
        // to the nearest focusable thing above it — the line — which took
        // the keyboard down from under a thumb that only meant to mark.
        // Putting it away is a tap on nothing (`onTapAway`), on purpose.
        // (A line's menu is portalled out of the list but is still its child
        // to React, so its presses come through here too; they are its own.)
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (coarse) {
          if (!(event.target as HTMLElement).closest('audio, video, input, textarea')) {
            event.preventDefault();
          }
          return;
        }
        pointing.current = true;
      }}
      // A press that moved no focus (a click to select words) must not be
      // remembered as the reason for the NEXT focus, which may be a Tab.
      onMouseUp={() => {
        pointing.current = false;
      }}
      onFocus={(event) => {
        const pressed = pointing.current;
        pointing.current = false;
        if (pressed) return;
        if (event.target !== event.currentTarget) {
          // A line's menu is portalled out of the list but is still its
          // child to React: its focus is its own.
          if (!event.currentTarget.contains(event.target as Node)) return;
          // Shift+Tab from below lands on the last control inside a line;
          // a move between lines, or out of a line's own controls, is not
          // coming in from outside.
          const from = event.relatedTarget as Node | null;
          if (!backTab.current || (from !== null && event.currentTarget.contains(from))) return;
          if (reachable().includes(event.target as HTMLElement)) return;
        }
        reachable().at(-1)?.focus();
      }}
      onKeyDown={(event) => {
        const el = event.target as HTMLElement;
        const all = reachable();
        const at = all.indexOf(el);
        // A key on a link, a mark or a player inside a line is that
        // control's own.
        if (at === -1 && el !== event.currentTarget) return;
        const go = (i: number) => {
          const next = all[Math.max(0, Math.min(all.length - 1, i))];
          if (next === undefined) return;
          event.preventDefault();
          next.focus();
        };
        const last = all.length - 1;
        if (event.key === 'ArrowUp') return go(at === -1 ? last : at - 1);
        if (event.key === 'ArrowDown') return go(at === -1 ? last : at + 1);
        if (event.key === 'Home') return go(0);
        if (event.key === 'End') return go(last);
        if (at === -1) return;
        if (
          event.key === 'Enter' ||
          event.key === ' ' ||
          event.key === 'ContextMenu' ||
          (event.key === 'F10' && event.shiftKey)
        ) {
          // The menu the long press and the right click open, opened the
          // same way: Radix anchors it where the event says, so near the
          // start of the line rather than in the corner of the screen.
          // Shift+F10 and the menu key are handled here too, because the
          // browser only turns them into a `contextmenu` when the operating
          // system does, and prevented they are not opened twice.
          event.preventDefault();
          const box = el.getBoundingClientRect();
          el.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: box.left + 24,
              clientY: box.top + Math.min(box.height / 2, 24),
            }),
          );
          return;
        }
        if (event.key === 'Tab') {
          // Out of the list, not into the next line's marks and links: the
          // arrows are the way through it, the menu the way into a line.
          const out = beyond(event.currentTarget, event.shiftKey);
          if (out === undefined) return;
          event.preventDefault();
          out.focus();
        }
      }}
      onClick={(event) => {
        // On a phone with the keyboard up, a tap on the conversation that
        // lands on nothing puts the keyboard away so he can read (Marc,
        // 2026-11-01). The lift of a long press or a swipe never gets here:
        // the line swallows it on the way down.
        if (!coarse || event.detail === 0) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        const field = document.activeElement;
        if (!(field instanceof HTMLElement) || field.id !== 'say') return;
        if ((event.target as HTMLElement).closest('a, button, img, video, audio, input')) return;
        if ((window.getSelection()?.toString() ?? '') !== '') return;
        onTapAway();
      }}
    >
      {empty ? (
        <li className="lines-empty quiet">
          {/* Nobody has said anything: the face, putting its glasses on,
              waiting with him. */}
          <Logo size={72} hole="var(--bg)" motion="on" className="mx-auto mb-3 block text-line" />
          {t('room.empty')}
        </li>
      ) : null}
      {rows.map((row) =>
        row.kind === 'day' ? (
          <li key={`day-${row.key}`} className="day" data-testid="day">
            <span>{row.label}</span>
          </li>
        ) : row.kind === 'new' ? (
          <li key="new" ref={newMark} className="day day-new" data-testid="since">
            <span>{row.label}</span>
          </li>
        ) : row.message.kind === 'chat' || row.message.kind === 'prompt' ? (
          // Only what a dad typed gets a menu: the room's own lines are facts
          // about the evening, not quotes, and nobody's to take back. Yours
          // also carries the way to take it back.
          <LineMenu
            key={row.key}
            body={row.message.body}
            mine={marksOf(row.message, you)}
            // Any dad may keep anybody's picture, unlike taking a line back:
            // what the room keeps belongs to the five of them.
            keep={
              row.message.media
                ? { kept: row.message.media.kept, onKeep: () => onKeep(row.message.media!) }
                : undefined
            }
            onReact={(emoji, on) => onReact(row.message.id, emoji, on)}
            onRetract={row.message.memberId === you ? () => onRetract(row.message.id) : undefined}
            onReply={() => onReply(row.message)}
            onEdit={row.message.memberId === you ? () => onEdit(row.message) : undefined}
            onAway={onAway}
          >
            <li
              className={`group line line-${row.message.kind}${row.showName ? '' : ' is-continued'}${arrived(row.key) ? ' motion-rise' : ''}`}
              data-testid="line"
              // Reached by the arrows from the list, never by Tab: five
              // hundred lines are not five hundred Tab stops.
              tabIndex={-1}
              // The finger lifting at the end of a long press is a click to
              // the browser. Caught on the way DOWN, before the photo's button,
              // the link or the marks below ever hear it.
              onPointerDownCapture={(event) => {
                press.current = { at: Date.now(), whileOpen: menuOpen() };
                swiped.current = false;
                // A thumb, not a mouse (a drag with a mouse selects words),
                // and not on a player's own controls.
                if (!coarse || !event.isPrimary || event.pointerType === 'mouse') return;
                if ((event.target as HTMLElement).closest('audio, video, input')) return;
                swipe.current = {
                  s: swipeStart(event.clientX, event.clientY),
                  el: event.currentTarget,
                  id: event.pointerId,
                };
              }}
              onPointerMove={(event) => {
                const live = swipe.current;
                if (live === null || event.pointerId !== live.id) return;
                const was = live.s.phase;
                const { next, buzz: arm } = swipeMove(live.s, event.clientX, event.clientY);
                live.s = next;
                if (next.phase === 'scroll') return endSwipe();
                if (next.phase !== 'sideways') return;
                if (was !== 'sideways') {
                  live.el.setPointerCapture(live.id);
                  live.el.style.transition = 'none';
                  live.el.setAttribute('data-swiping', 'yes');
                }
                live.el.style.translate = `${next.offset}px`;
                live.el.style.setProperty('--swipe', String(next.offset / SWIPE_ARM_PX));
                if (arm) buzz();
              }}
              onPointerUp={() => {
                if (!endSwipe()) return;
                swiped.current = true;
                onReply(row.message);
                onAway();
              }}
              onPointerCancel={endSwipe}
              onClickCapture={(event) => {
                // A click with no pointer behind it — Enter or Space on a
                // link, a mark, the play button — is never the lift at the
                // end of a long press, whatever the last press was.
                if (event.detail === 0) return;
                if (!notATap(press.current) && !swiped.current) return;
                swiped.current = false;
                event.preventDefault();
                event.stopPropagation();
              }}
              // With a mouse, a double click on the words is a thumb, the way
              // every other chat has taught it: on, and off again on the next.
              // Not on a phone, where a double tap is a zoom gone wrong, and
              // not on a link, a photo or a control, each of which a double
              // tap would also open twice.
              onDoubleClick={(event) => {
                if (coarse) return;
                if ((event.target as HTMLElement).closest('a, button, img, video, audio')) return;
                const on = !marksOf(row.message, you).includes('👍');
                onReact(row.message.id, '👍', on);
              }}
            >
              {/* What the swipe is pulling in from the left: the reply arrow,
                  shown as far as the thumb has gone. */}
              <span className="swipe-reply" aria-hidden="true">
                <Reply size={16} />
              </span>
              {/* Only at the top of a run. A face on every line of one turn is
                  the app repeating who is talking between every sentence,
                  which is what dropping the name fixed. */}
              {/* His name and his face are his profile, for a dad still in
                  the room (Marc chose it, 2026-11-01): the same screen "Who's
                  here" opens. A man who has left has none, so his stay words. */}
              {row.showName && row.message.memberId !== null ? (
                inRoom.has(row.message.memberId) ? (
                  <button
                    type="button"
                    className="face block h-8 w-8 cursor-pointer rounded-full"
                    aria-label={`${row.message.name} ${t('line.profile_of')}`}
                    onClick={() => onOpenProfile(row.message.memberId!)}
                    data-testid="line-face"
                  >
                    <Face className="block" memberId={row.message.memberId} size={32} />
                    <span className="sr-only">
                      {row.message.name} {t('line.profile_of')}
                    </span>
                  </button>
                ) : (
                  <Face className="face" memberId={row.message.memberId} size={32} />
                )
              ) : null}
              {row.showName && row.message.memberId !== null && inRoom.has(row.message.memberId) ? (
                // The name as it always looked, now a button: the row is
                // short, so the padding reaches past it without moving it.
                <button
                  type="button"
                  className="who -my-1 min-h-7 cursor-pointer justify-self-start py-1 text-left"
                  style={{ color: dadVar(row.message.memberId) }}
                  onClick={() => onOpenProfile(row.message.memberId!)}
                  data-testid="line-who"
                >
                  {row.message.name}
                  <span className="sr-only"> {t('line.profile_of')}</span>
                </button>
              ) : (
                <span
                  className="who"
                  style={
                    row.showName && row.message.memberId !== null
                      ? { color: dadVar(row.message.memberId) }
                      : undefined
                  }
                >
                  {row.showName ? row.message.name : ''}
                </span>
              )}
              <span className="body">
                {/* What he was answering, as it was: a name and a cut-down
                    line, above his own. It goes nowhere on a tap — the
                    original may be older than the backfill. */}
                {row.message.reply ? <Quote reply={row.message.reply} /> : null}
                {row.message.kind === 'prompt' ? (
                  <span className="answer-tag">{t('line.answered')}</span>
                ) : null}
                {parts(row.message.body).map((part, i) =>
                  part.link ? (
                    <a
                      key={i}
                      href={part.href}
                      title={part.href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {shortLink(part.text)}
                    </a>
                  ) : (
                    <span key={i}>
                      {/* A dad named with an "@" is in his colour: a name,
                          not a word. The text is what he typed. */}
                      {splitMentions(part.text, people).map((bit, j) =>
                        bit.mention ? (
                          <span
                            key={j}
                            className="mention"
                            style={{ color: dadVar(bit.id) }}
                            data-testid="mention"
                          >
                            {bit.text}
                          </span>
                        ) : (
                          bit.text
                        ),
                      )}
                    </span>
                  ),
                )}
                {row.message.editedAt ? (
                  <span className="edited" data-testid="edited">
                    {t('line.edited')}
                  </span>
                ) : null}
                {/* What the page at the first link says about itself, once
                    the room has asked it. One card, like every chat draws. */}
                {firstLink(row.message.body) !== null ? (
                  <LinkPreviewCard href={firstLink(row.message.body)!} />
                ) : null}
                {row.message.media ? (
                  <Attachment
                    media={row.message.media}
                    from={row.message.name}
                    onOpen={() => onOpenPhoto(row.message.media!.id)}
                  />
                ) : null}
                <Marks
                  reactions={row.message.reactions}
                  me={you}
                  nameOf={nameOf}
                  onToggle={(emoji, on) => onReact(row.message.id, emoji, on)}
                />
              </span>
              <span className="when items-start gap-1">
                <time dateTime={new Date(row.message.createdAt).toISOString()}>
                  {clock(row.message.createdAt)}
                </time>
                <QuickMark
                  mine={marksOf(row.message, you)}
                  onReact={(emoji, on) => onReact(row.message.id, emoji, on)}
                />
              </span>
            </li>
          </LineMenu>
        ) : (
          // The room talking. It carries what happened, not a sentence, so it
          // can be read in either language — and falls back to the English
          // body for a line written before that was true.
          <li
            key={row.key}
            className={`line line-${row.message.kind}${row.joined ? ' is-joined' : ''}`}
            data-testid="line"
          >
            <span className="body">
              {row.message.said
                ? describeSaid(t, lang, row.message.said, row.joined)
                : row.message.body}
            </span>
          </li>
        ),
      )}
      {/* The scroll target, and nothing else: an item so the list is still a
          list to a screen reader, hidden so it is not counted. */}
      <li ref={bottom} aria-hidden="true" className="m-0 h-0 p-0" />
    </ol>
  );
}

/**
 * What he was answering, as it was: a small card with a bar in the colour of
 * the man who said it, and his name in that colour over the cut-down line.
 * It was a hairline and a grey name, and read as a footnote to the answer
 * rather than the thing being answered. Goes nowhere on a tap — the original
 * may be older than the backfill.
 */
export function Quote({
  reply,
  label,
}: {
  reply: { name: string; body: string };
  /** What the coloured line says, when it is not just his name. */
  label?: string;
}) {
  const who = useMemberNamed(reply.name);
  const colour = who ? dadVar(who.memberId) : 'var(--border-strong)';
  return (
    <span
      className="quote"
      data-testid="quote"
      // The name at full strength only where it is a dad's colour, which the
      // contrast audit holds as text on this ground; otherwise ink.
      style={{ '--quote': colour, '--quote-ink': who ? colour : 'var(--text)' } as CSSProperties}
    >
      <span className="quote-who">{label ?? reply.name}</span>
      <span className="quote-body">{reply.body}</span>
    </span>
  );
}
