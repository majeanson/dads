import * as Popover from '@radix-ui/react-popover';
import { Plus, SmilePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MARKS, type Reaction, type RoomMessage } from '../shared/protocol';
import { Face } from './Face';
import { noteMark, readTally, sixFor } from './favourites';
import { useT } from './i18n';
import { cn } from './ui/cn';

/** How long a thumb holds a mark before it is asking who, not marking. */
export const HOLD_MS = 500;
/** A finger that has wandered this far is scrolling, not holding. */
const HOLD_SLACK = 10;

/** Which marks this dad has already put on a line. */
export function marksOf(message: RoomMessage, me: string): string[] {
  return (message.reactions ?? []).filter((r) => r.by.includes(me)).map((r) => r.emoji);
}

/**
 * The marks on a line.
 *
 * Rendered only when there are some, which is nearly never — that is what
 * keeps this out of the conversation. Adding one lives in the long-press
 * menu, so a line that nobody has marked carries no control at all, and the
 * room at rest looks exactly as it did before any of this existed.
 *
 * The count is the number of dads, not a badge: in a group of five, "3"
 * beside a thumb is the whole story and a list of names is not worth the row.
 * Who they are is in the title and in the accessible name — and, for the
 * evening somebody wants to know (Marc asked, 2026-11-01), under a long
 * press on the mark: the faces and the names, on a card over it.
 */
export function Marks({
  reactions,
  me,
  nameOf,
  onToggle,
}: {
  reactions: Reaction[] | undefined;
  me: string;
  nameOf: (memberId: string) => string;
  onToggle: (emoji: string, on: boolean) => void;
}) {
  if (reactions === undefined || reactions.length === 0) return null;

  return (
    <span className="marks">
      {reactions.map((r) => (
        <Mark
          key={r.emoji}
          reaction={r}
          mine={r.by.includes(me)}
          nameOf={nameOf}
          onToggle={(on) => onToggle(r.emoji, on)}
        />
      ))}
    </span>
  );
}

/**
 * One mark: a tap adds yours or takes it off; a hold, or a right-click, says
 * who put it there.
 *
 * The hold is the mark's own and not the line's. The line under it is a
 * Radix context-menu trigger whose long press is a timer started on
 * pointerdown, and whose handlers stand down when the event was already
 * default-prevented by the time it bubbles up — so the mark prevents its own
 * pointerdown and contextmenu, and the line's menu stays shut. The click that
 * ends a hold is swallowed here too (`held`), otherwise asking who put a
 * thumb on a line would also put yours on it.
 */
function Mark({
  reaction: r,
  mine,
  nameOf,
  onToggle,
}: {
  reaction: Reaction;
  mine: boolean;
  nameOf: (memberId: string) => string;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useT();
  const [who, setWho] = useState(false);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  /** The card was up when the finger landed: that tap is its dismissal, not a mark. */
  const openAtDown = useRef(false);
  const from = useRef({ x: 0, y: 0 });
  const names = r.by.map(nameOf).join(', ');

  const letGo = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => letGo, []);

  return (
    <Popover.Root open={who} onOpenChange={setWho}>
      <Popover.Anchor asChild>
        <button
          type="button"
          aria-pressed={mine}
          aria-label={`${r.emoji} — ${names}`}
          title={names}
          data-testid="mark"
          onPointerDown={(event) => {
            // Ours, not the line's: see above.
            event.preventDefault();
            held.current = false;
            openAtDown.current = who;
            from.current = { x: event.clientX, y: event.clientY };
            letGo();
            timer.current = window.setTimeout(() => {
              timer.current = null;
              held.current = true;
              setWho(true);
            }, HOLD_MS);
          }}
          onPointerMove={(event) => {
            if (timer.current === null) return;
            const dx = event.clientX - from.current.x;
            const dy = event.clientY - from.current.y;
            if (Math.hypot(dx, dy) > HOLD_SLACK) letGo();
          }}
          onPointerUp={letGo}
          onPointerLeave={letGo}
          // The browser took the finger (a scroll begun on the mark): no
          // click is coming to spend `held`, so it is spent here, or the
          // next real tap would be swallowed.
          onPointerCancel={() => {
            letGo();
            held.current = false;
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            letGo();
            setWho(true);
          }}
          onClick={() => {
            if (held.current) {
              held.current = false;
              return;
            }
            // Tapping the mark with its card up puts the card away (the
            // press outside the card already did), and is not a mark.
            if (openAtDown.current) {
              openAtDown.current = false;
              return;
            }
            onToggle(!mine);
          }}
          className={cn(
            // 32px, not 28: the screens suite refuses anything under 28 and
            // a mark that lands exactly on the floor is a mark one rounding
            // error away from failing it.
            'inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border px-2.5',
            'text-xs leading-none transition-[border-color,color,scale] duration-100 active:scale-90',
            // A mark that appears pops; one already there stays put and only
            // its count moves.
            'motion-pop',
            mine ? 'border-accent text-ink' : 'border-line text-muted hover:border-edge',
          )}
        >
          <span aria-hidden="true">{r.emoji}</span>
          {/* Keyed on the count, so the number ticks when a dad adds his. */}
          <span key={r.by.length} className="motion-tick tabular-nums">
            {r.by.length}
          </span>
          <span className="sr-only">{t('line.marked')}</span>
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          aria-label={`${r.emoji} — ${t('line.who_marked')}`}
          // The thumb that opened it is still on the mark; focus stays there
          // and Escape or a tap anywhere else puts it away.
          onOpenAutoFocus={(event) => event.preventDefault()}
          className={[
            'z-50 w-max max-w-[var(--radix-popper-available-width)] rounded-lg',
            'border border-line bg-paper p-2 text-ink shadow-lg',
            'motion-pop origin-[var(--radix-popper-transform-origin)]',
          ].join(' ')}
          data-testid="mark-who"
        >
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {r.by.map((memberId) => (
              <li key={memberId} className="flex items-center gap-2 text-[0.9375rem]">
                <Face memberId={memberId} size={24} />
                <span className="min-w-0 truncate">{nameOf(memberId)}</span>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Six marks in a row, and a "+" for the rest. Shared by the long-press menu
 * and the quick button, so there is one place that decides what a mark looks
 * like. The six are learnt (`favourites.ts`): the defaults at
 * first, then whatever this dad actually uses. The ones already his are
 * outlined; they wrap rather than shrink when squeezed.
 */
export function MarkRow({
  mine,
  onReact,
  inMenu = false,
}: {
  mine: string[];
  onReact: (emoji: string, on: boolean) => void;
  /** Inside a line's menu, where a menu may hold only menu items: the marks
   * are then checkable items and the "+" an item, read as such. Everywhere
   * else they are toggle buttons. */
  inMenu?: boolean;
}) {
  const { t } = useT();
  const [more, setMore] = useState(false);
  // Read once per row, not per render: the tap that counts a mark re-renders
  // the row it is in, and the six reshuffled under his thumb inside a menu
  // that was still open. The next row he opens has learnt it.
  const [six] = useState(() => sixFor(readTally(), Date.now()));
  const pick = (emoji: string, on: boolean) => {
    if (on) noteMark(emoji);
    onReact(emoji, on);
  };
  const mark = (emoji: string) => {
    const on = mine.includes(emoji);
    return (
      <button
        key={emoji}
        type="button"
        {...(inMenu ? { role: 'menuitemcheckbox', 'aria-checked': on } : { 'aria-pressed': on })}
        aria-label={emoji}
        data-testid={`react-${emoji}`}
        onClick={() => pick(emoji, !on)}
        className={cn(
          // 44px, a thumb: this row is in the long-press menu on a phone.
          'grid h-11 min-w-11 flex-1 cursor-pointer place-items-center rounded-app',
          'border text-xl transition-[border-color,background-color,scale] duration-100 active:scale-90',
          on ? 'border-accent bg-panel' : 'border-transparent hover:border-edge',
        )}
      >
        {emoji}
      </button>
    );
  };
  return (
    <div role="group" aria-label={t('line.react')}>
      <div className="flex flex-wrap gap-0.5">
        {six.map(mark)}
        <button
          type="button"
          aria-expanded={more}
          role={inMenu ? 'menuitem' : undefined}
          aria-label={t('line.more_marks')}
          data-testid="react-more"
          onClick={() => setMore((v) => !v)}
          className={cn(
            'grid h-11 min-w-11 flex-1 cursor-pointer place-items-center rounded-app border text-muted',
            'transition-[border-color,scale] duration-100 active:scale-90',
            more ? 'border-accent' : 'border-transparent hover:border-edge',
          )}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </div>
      {more ? (
        <div className="motion-rise mt-1 grid grid-cols-8 gap-0.5" data-testid="react-all">
          {(MARKS as readonly string[]).filter((e) => !six.includes(e)).map(mark)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A mark without the long press, for a mouse.
 *
 * On a laptop nobody long-presses and a right-click is a thing a man has to
 * be told about, so a small button appears at the end of the line under the
 * pointer and opens the same five. Hidden where the pointer is a thumb: a
 * phone has the long press, the double tap, and no hover to reveal this on.
 * Always in the tree so the clock's column keeps one width; only its opacity
 * moves.
 */
export function QuickMark({
  mine,
  onReact,
}: {
  mine: string[];
  onReact: (emoji: string, on: boolean) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t('line.react')}
          data-testid="quick-mark"
          className={cn(
            'hidden h-7 w-7 cursor-pointer place-items-center rounded-app border border-transparent text-muted',
            'pointer-fine:grid',
            'transition-opacity duration-75 hover:border-edge hover:text-ink',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            open && 'opacity-100',
          )}
        >
          <SmilePlus size={15} aria-hidden="true" />
          <span className="sr-only">{t('line.react')}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className={[
            'z-50 w-max max-w-[var(--radix-popper-available-width)] rounded-lg',
            'border border-line bg-paper p-1 text-ink shadow-lg',
            'motion-pop origin-[var(--radix-popper-transform-origin)]',
          ].join(' ')}
          data-testid="quick-marks"
        >
          <MarkRow
            mine={mine}
            onReact={(emoji, on) => {
              onReact(emoji, on);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
