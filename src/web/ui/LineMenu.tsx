import * as ContextMenu from '@radix-ui/react-context-menu';
import { Copy, Pencil, Pin, PinOff, Reply, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { MarkRow } from '../Marks';
import { cn } from './cn';

/**
 * When a line's menu last opened, and whether one is open now.
 *
 * A long press on a phone ends with the finger lifting, and the browser calls
 * that lift a click: on a photograph it opened the viewer UNDER the menu, on a
 * link it followed it, on the words it opened the marks. So a line swallows
 * the click of a press DURING which a menu opened, or that began while one
 * was open (`notATap`). Not "a click soon after": that is a guess about time,
 * and a quick real tap after closing the menu fell inside it.
 */
let openedAt = 0;
let isOpen = false;

export function notATap(press: { at: number; whileOpen: boolean }): boolean {
  return press.whileOpen || openedAt >= press.at;
}

export function menuOpen(): boolean {
  return isOpen;
}

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
  onReply,
  onEdit,
  onAway,
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
  /** Answer this line: the composer takes a quote of it. Anybody's. */
  onReply: () => void;
  /** Change the words. His own only, like taking it back. */
  onEdit?: () => void;
  /** Where the focus goes once Reply or Edit has sent him away: the composer. */
  onAway?: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);
  /**
   * Reply and Edit send him to the composer. What they DO happens on select,
   * so the composer is already replying or editing by the time his thumb gets
   * there; where the FOCUS goes waits until the menu has finished closing,
   * in place of Radix handing it back to the line. It used to be a tick after
   * select, which raced the menu twice — its focus trap if the tick came
   * early, its hand-back after the exit animation if it came late — and on a
   * busy machine the caret ended on the line for good. `onCloseAutoFocus` is
   * the one moment neither can follow. (Deferring the action with the focus
   * was tried: then words typed before the menu had gone landed in a composer
   * that did not yet know it was editing.)
   */
  const away = useRef(false);
  /**
   * Whether THIS menu is the one open. Radix only reports a close that
   * happens; a menu unmounted while open — the line under it taken back by
   * the man who said it, on another phone — reports nothing, and the flag
   * above stayed up for good: every tap on every line after that was
   * swallowed as the lift of a long press, until another menu opened and
   * closed. Unmounting takes the flag down if it was ours.
   */
  const ours = useRef(false);
  useEffect(
    () => () => {
      if (ours.current) isOpen = false;
    },
    [],
  );

  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        isOpen = open;
        ours.current = open;
        if (open) openedAt = Date.now();
        else setArmed(false);
      }}
    >
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
            'motion-pop origin-[var(--radix-popper-transform-origin)]',
          ].join(' ')}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            if (!away.current) return;
            away.current = false;
            event.preventDefault();
            onAway?.();
          }}
          data-testid="line-menu"
        >
          {/* The marks first, because it is the one anybody presses. They
              share the row and wrap rather than shrinking to nothing when the
              menu is squeezed; the ones already yours are outlined. */}
          <MarkRow mine={mine} onReact={onReact} />

          <ContextMenu.Separator className="my-1 h-px bg-line" />

          <ContextMenu.Item
            className={ITEM}
            data-testid="line-reply"
            onSelect={() => {
              away.current = true;
              onReply();
            }}
          >
            <Reply size={15} aria-hidden="true" className="text-muted" />
            {t('line.reply')}
          </ContextMenu.Item>

          {onEdit === undefined || body === '' ? null : (
            <ContextMenu.Item
              className={ITEM}
              data-testid="line-edit"
              onSelect={() => {
                away.current = true;
                onEdit();
              }}
            >
              <Pencil size={15} aria-hidden="true" className="text-muted" />
              {t('line.edit')}
            </ContextMenu.Item>
          )}

          {body === '' ? null : (
            <ContextMenu.Item
              className={ITEM}
              data-testid="line-copy"
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
