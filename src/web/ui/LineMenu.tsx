import * as ContextMenu from '@radix-ui/react-context-menu';
import { Copy, Pin, PinOff, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { REACTIONS } from '../../shared/protocol';
import { useT } from '../i18n';
import { cn } from './cn';

const ITEM = [
  'flex cursor-pointer items-center gap-2.5 rounded-app px-2.5 py-2 text-[0.9375rem]',
  'outline-none select-none',
  'data-[highlighted]:bg-panel',
].join(' ');

/**
 * What you can do to a line: copy it, and take it back if it is yours.
 *
 * A context menu rather than a control on every row, because a chat line
 * already has a name, a clock and sometimes a photograph on it, and a fourth
 * thing would be one too many. Radix's is the right primitive for exactly one
 * reason: it is right-click on a laptop and a long press on a phone from the
 * same component, with the keyboard route (the menu key, Shift+F10) included.
 *
 * Taking it back ARMS first. It is irreversible and it takes the photograph
 * with it, and a long press is a gesture a thumb makes by accident; one more
 * deliberate tap is the cheapest possible guard, and Escape or a tap outside
 * calls it off.
 */
export function LineMenu({
  body,
  mine,
  keep,
  onRetract,
  onReact,
  children,
}: {
  body: string;
  /** Which marks this dad has already put on the line. */
  mine: string[];
  /**
   * Present only when the line carries a photograph or a file, which is what
   * the shelf can take. Any dad may keep anybody's, unlike taking one back.
   */
  keep?: { kept: boolean; onKeep: () => void };
  /** Absent when the line is not his — then this is a copy menu and no more. */
  onRetract?: () => void;
  onReact: (emoji: string, on: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);

  return (
    <ContextMenu.Root onOpenChange={(open) => !open && setArmed(false)}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          /*
           * `--radix-popper-available-width` is the room actually left at the
           * point he pressed, and it is the only honest ceiling here: a menu
           * opened near the right-hand edge of a 430px phone has about 200px,
           * and a fixed width ignored that and put the fifth mark off the
           * screen where nobody could reach it. Capped by the variable and
           * allowed to wrap, it is never clipped wherever he presses.
           */
          className={[
            'z-50 w-max max-w-[var(--radix-popper-available-width)] rounded-lg',
            'border border-line bg-paper p-1 text-ink shadow-lg',
            'data-[state=open]:animate-in data-[state=open]:fade-in',
          ].join(' ')}
          collisionPadding={12}
          data-testid="line-menu"
        >
          {/* The marks first, because it is the one anybody presses. They
              share the row and wrap rather than shrinking to nothing when the
              menu is squeezed; the ones already yours are outlined. */}
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
                    'grid h-10 min-w-9 flex-1 cursor-pointer place-items-center rounded-app',
                    'border text-lg transition-colors duration-75',
                    on ? 'border-accent bg-panel' : 'border-transparent hover:border-edge',
                  )}
                >
                  {emoji}
                </button>
              );
            })}
          </div>

          <ContextMenu.Separator className="my-1 h-px bg-line" />

          {body === '' ? null : (
            <ContextMenu.Item
              className={ITEM}
              onSelect={() => {
                // Best effort: an insecure origin or a browser that refuses
                // the clipboard is not worth an error a dad cannot act on.
                void navigator.clipboard?.writeText(body).catch(() => {});
              }}
            >
              <Copy size={15} aria-hidden="true" className="text-muted" />
              {t('line.copy')}
            </ContextMenu.Item>
          )}

          {/* No arming. Keeping is reversible and costs nothing, and letting
              one go does not delete it — it puts the picture back on the
              shelf, where the next upload may or may not be the end of it. */}
          {keep === undefined ? null : (
            <ContextMenu.Item className={ITEM} data-testid="line-keep" onSelect={keep.onKeep}>
              {keep.kept ? (
                <PinOff size={15} aria-hidden="true" className="text-muted" />
              ) : (
                <Pin size={15} aria-hidden="true" className="text-muted" />
              )}
              {keep.kept ? t('line.let_go') : t('line.keep')}
            </ContextMenu.Item>
          )}

          {onRetract === undefined ? null : (
            <ContextMenu.Item
              // Armed, the row fills rather than merely changing its words:
              // colour is the fastest thing to read, and the menu keeps one
              // width so nothing moves under the thumb between the two taps.
              className={cn(
                ITEM,
                armed ? 'bg-danger text-paper data-[highlighted]:bg-danger' : 'text-danger',
              )}
              data-testid="line-retract"
              onSelect={(event) => {
                if (!armed) {
                  // Keep the menu open rather than throwing a dialog over the
                  // conversation.
                  event.preventDefault();
                  setArmed(true);
                  return;
                }
                onRetract();
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
              {armed ? t('line.retract_sure') : t('line.retract')}
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
