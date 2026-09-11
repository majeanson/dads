import type { Reaction, RoomMessage } from '../shared/protocol';
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
              'text-xs leading-none transition-colors duration-75',
              mine ? 'border-accent text-ink' : 'border-line text-muted hover:border-edge',
            )}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <span className="tabular-nums">{r.by.length}</span>
            <span className="sr-only">{t('line.marked')}</span>
          </button>
        );
      })}
    </span>
  );
}
