import * as Popover from '@radix-ui/react-popover';
import { SmilePlus } from 'lucide-react';
import { useState } from 'react';
import { REACTIONS, type Reaction, type RoomMessage } from '../shared/protocol';
import { useT } from './i18n';
import { cn } from './ui/cn';

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
 * Who they are is in the title and in the accessible name, for the evening
 * somebody wants to know.
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
  const { t } = useT();
  if (reactions === undefined || reactions.length === 0) return null;

  return (
    <span className="marks">
      {reactions.map((r) => {
        const mine = r.by.includes(me);
        const who = r.by.map(nameOf).join(', ');
        return (
          <button
            key={r.emoji}
            type="button"
            aria-pressed={mine}
            aria-label={`${r.emoji} — ${who}`}
            title={who}
            data-testid="mark"
            onClick={() => onToggle(r.emoji, !mine)}
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
        );
      })}
    </span>
  );
}

/**
 * The five, in a row. Shared by the long-press menu and the quick button,
 * so there is one place that decides what a mark looks like. The ones
 * already his are outlined; they wrap rather than shrink when squeezed.
 */
export function MarkRow({
  mine,
  onReact,
}: {
  mine: string[];
  onReact: (emoji: string, on: boolean) => void;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('line.react')}>
      {REACTIONS.map((emoji) => {
        const on = mine.includes(emoji);
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={on}
            aria-label={emoji}
            data-testid={`react-${emoji}`}
            onClick={() => onReact(emoji, !on)}
            className={cn(
              // 44px, a thumb: this row is what a tap on a line opens on a
              // phone now, as well as the long-press menu.
              'grid h-11 min-w-11 flex-1 cursor-pointer place-items-center rounded-app',
              'border text-xl transition-[border-color,background-color,scale] duration-100 active:scale-90',
              on ? 'border-accent bg-panel' : 'border-transparent hover:border-edge',
            )}
          >
            {emoji}
          </button>
        );
      })}
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
