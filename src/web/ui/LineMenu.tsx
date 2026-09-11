import * as ContextMenu from '@radix-ui/react-context-menu';
import { Copy, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useT } from '../i18n';

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
  onRetract,
  children,
}: {
  body: string;
  /** Absent when the line is not his — then this is a copy menu and no more. */
  onRetract?: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);

  return (
    <ContextMenu.Root onOpenChange={(open) => !open && setArmed(false)}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={[
            'z-50 min-w-44 rounded-lg border border-line bg-paper p-1 text-ink shadow-lg',
            'data-[state=open]:animate-in data-[state=open]:fade-in',
          ].join(' ')}
          data-testid="line-menu"
        >
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

          {onRetract === undefined ? null : (
            <ContextMenu.Item
              className={`${ITEM} text-danger`}
              data-testid="line-retract"
              onSelect={(event) => {
                if (!armed) {
                  // Keep the menu open and change what the item says, rather
                  // than throwing a dialog over the conversation.
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
