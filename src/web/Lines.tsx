import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Attachment as MessageAttachment, RoomMessage } from '../shared/protocol';
import { parts, shortLink } from '../shared/linkify';
import { describeSaid } from '../shared/said';
import { Attachment } from './Attachment';
import { Face } from './Face';
import { dadVar } from './dadColour';
import { useT } from './i18n';
import { Logo } from './Logo';
import { MarkRow, Marks, marksOf, QuickMark } from './Marks';
import type { Row } from './messageGroups';
import { LineMenu, menuOpen, notATap } from './ui/LineMenu';

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The marks a tap opens under a line keep themselves on the screen. Tapping
 * the LAST line — the one a man at the bottom is most likely to answer —
 * opened the row below the fold, and "+" grew it further down still. So the
 * list scrolls just enough to show all of it, when it opens and whenever it
 * grows; `nearest` does nothing when it is already in view.
 */
function inView(el: HTMLElement | null) {
  if (!el) return;
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const show = () => el.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  const watch = new ResizeObserver(show);
  watch.observe(el);
  return () => watch.disconnect();
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
   * On a phone, one tap on a line puts the five marks under it.
   *
   * The long press was the only way in, and a long press is a gesture nobody
   * finds; the double tap gave a thumb and nothing else. A tap is what a thumb
   * already does to a line, so it opens the row, and a second tap on a mark
   * is the choice. Only where the pointer IS a thumb: on a laptop a click on a
   * line is a man selecting text, and the quick button under the pointer is
   * already there.
   */
  const [coarse] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true,
  );
  const [marking, setMarking] = useState<string | null>(null);
  /** The press in progress: when it began, and whether a menu was open. */
  const press = useRef({ at: 0, whileOpen: false });

  return (
    <ol className="lines" aria-label={t('room.messages')} ref={lines} onScroll={onScroll}>
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
              data-marking={marking === row.message.id ? 'yes' : undefined}
              // The finger lifting at the end of a long press is a click to
              // the browser. Caught on the way DOWN, before the photo's button,
              // the link or the marks below ever hear it.
              onPointerDownCapture={() => {
                press.current = { at: Date.now(), whileOpen: menuOpen() };
              }}
              onClickCapture={(event) => {
                if (!notATap(press.current)) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                if (!coarse) return;
                if ((event.target as HTMLElement).closest('a, button, img, video, audio')) return;
                // A man selecting words to copy is not asking for marks.
                if ((window.getSelection()?.toString() ?? '') !== '') return;
                setMarking((m) => (m === row.message.id ? null : row.message.id));
              }}
              // With a mouse, a double click on the words is a thumb, the way
              // every other chat has taught it: on, and off again on the next.
              // Not on a phone, where the single tap opens the row instead, and
              // not on a link, a photo or a control, each of which a double
              // tap would also open twice.
              onDoubleClick={(event) => {
                if (coarse) return;
                if ((event.target as HTMLElement).closest('a, button, img, video, audio')) return;
                const on = !marksOf(row.message, you).includes('👍');
                onReact(row.message.id, '👍', on);
              }}
            >
              {/* Only at the top of a run. A face on every line of one turn is
                  the app repeating who is talking between every sentence,
                  which is what dropping the name fixed. */}
              {row.showName && row.message.memberId !== null ? (
                <Face className="face" memberId={row.message.memberId} size={32} />
              ) : null}
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
              <span className="body">
                {/* What he was answering, as it was: a name and a cut-down
                    line, above his own. It goes nowhere on a tap — the
                    original may be older than the backfill. */}
                {row.message.reply ? (
                  <span className="quote" data-testid="quote">
                    <span className="quote-who">{row.message.reply.name}</span>
                    {row.message.reply.body}
                  </span>
                ) : null}
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
                    <span key={i}>{part.text}</span>
                  ),
                )}
                {row.message.editedAt ? (
                  <span className="edited" data-testid="edited">
                    {t('line.edited')}
                  </span>
                ) : null}
                {row.message.media ? (
                  <Attachment
                    media={row.message.media}
                    onOpen={() => onOpenPhoto(row.message.media!.id)}
                  />
                ) : null}
                <Marks
                  reactions={row.message.reactions}
                  me={you}
                  nameOf={nameOf}
                  onToggle={(emoji, on) => onReact(row.message.id, emoji, on)}
                />
                {marking === row.message.id ? (
                  <span ref={inView} className="line-marks motion-rise" data-testid="tap-marks">
                    <MarkRow
                      mine={marksOf(row.message, you)}
                      onReact={(emoji, on) => {
                        onReact(row.message.id, emoji, on);
                        setMarking(null);
                      }}
                    />
                  </span>
                ) : null}
              </span>
              <span className="when flex items-start gap-1">
                <time>{clock(row.message.createdAt)}</time>
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
