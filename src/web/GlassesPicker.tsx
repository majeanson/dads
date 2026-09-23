import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { GLASSES, type GlassesKind } from '../shared/protocol';
import { setMyGlasses } from './api';
import { useT } from './i18n';
import { Glasses } from './Logo';
import { cn } from './ui/cn';

/**
 * Which pair he wears.
 *
 * One button beside "Add a face", wearing the pair he has on, that opens the
 * six. A row of all six under his face cost Settings ninety pixels and took
 * the sheet past the bottom of a small phone, which is the one thing that
 * sheet is measured never to do.
 *
 * Not optimistic: a pair that failed to save and showed as chosen would be
 * the one screen in the room that disagreed with the others.
 */
export function GlassesPicker({ worn }: { worn: GlassesKind | undefined }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const current = worn ?? 'shades';

  async function wear(kind: GlassesKind) {
    setBusy(true);
    setError(false);
    try {
      await setMyGlasses(kind);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="glasses-open"
          className={cn(
            // The same shape as "Add a face", which it sits beside.
            'inline-flex h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-4',
            'border border-edge text-[1.0625rem] font-medium text-ink transition-colors duration-75',
            'hover:border-accent hover:text-accent',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <Glasses kind={current} width={30} />
          {t('you.glasses')}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'z-50 w-max max-w-[var(--radix-popper-available-width)] rounded-[var(--radius-control)]',
            'border border-line bg-paper p-2 text-ink shadow-lg',
            'motion-pop origin-[var(--radix-popper-transform-origin)]',
          )}
        >
          <div
            role="group"
            aria-label={t('you.glasses')}
            className="grid grid-cols-3 gap-1.5"
            data-testid="glasses-picker"
          >
            {GLASSES.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={current === kind}
                aria-label={t(`glasses.${kind}`)}
                title={t(`glasses.${kind}`)}
                disabled={busy}
                onClick={() => void wear(kind)}
                data-testid={`glasses-${kind}`}
                className={cn(
                  'grid h-12 w-20 cursor-pointer place-items-center rounded-[var(--radius-control)] border',
                  'transition-[border-color,scale] duration-100 active:scale-90',
                  current === kind ? 'border-accent bg-panel' : 'border-edge hover:border-accent',
                )}
              >
                <Glasses kind={kind} width={44} />
              </button>
            ))}
          </div>
          {error ? (
            <p className="mt-2 text-[1.0625rem] text-danger" role="alert">
              {t('you.glasses_failed')}
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
