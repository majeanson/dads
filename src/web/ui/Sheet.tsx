import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Button } from './Button';

/**
 * A thing you open, look at, and close again.
 *
 * On Radix rather than the bare `<dialog>` it replaces: the focus trap, the
 * Escape key, the inert background and the labelling are the same problems
 * either way, and this is the version that has been got right by more people
 * than us. The bare element handled all of that too — what it could not do was
 * animate, or stay put on a phone while the keyboard comes up.
 *
 * On a phone it is the screen. On a laptop it is a panel over the room.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useT();

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] motion-fade" />
        <Dialog.Content
          className={[
            'motion-sheet fixed z-50 flex flex-col bg-paper text-ink shadow-2xl',
            // Phone: the whole screen, with room for the notch and the home
            // indicator. Laptop: a panel, centred, never taller than the room.
            'inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
            'sm:h-auto sm:max-h-[85dvh] sm:w-[min(34rem,calc(100vw-2rem))]',
            // The same radius home's card uses, so the two surfaces a dad
            // actually touches agree with each other.
            'sm:rounded-[var(--radius-card)] sm:border sm:border-line',
          ].join(' ')}
        >
          {/* Big, because on a phone this header is the top of the whole
              screen rather than the lip of a panel: it is the one word that
              says where he is. But it and the padding give way first on a
              SHORT screen, so what the sheet is for keeps the room: on a
              667px phone the title at 30px with a row of padding each side
              was a fifth of the screen before a word of content. */}
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-[clamp(0.6rem,1.6dvh,1rem)]">
            <Dialog.Title className="display m-0 text-[clamp(1.5rem,4.2dvh,1.875rem)]">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              {/* The word is still there for anything reading the page aloud,
                  and for a test: an icon with no name is a button nobody can
                  ask for. */}
              <Button look="quiet" size="icon" aria-label={t('sheet.close')}>
                <X size={22} aria-hidden="true" />
                <span className="sr-only">{t('sheet.close')}</span>
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-[clamp(0.9rem,2dvh,1.25rem)]">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
