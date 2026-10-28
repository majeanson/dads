import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { DAD_COLOURS } from '../shared/protocol';
import { setMyColour } from './api';
import { hashedColour } from './dadColour';
import { useT } from './i18n';
import { useMember } from './members';
import { Button } from './ui/Button';
import { cn } from './ui/cn';

/**
 * The colour a dad is shown in.
 *
 * Its own control beside the name, not a row tucked under the glasses: it is
 * a different choice, and it changes different things — so the popover says
 * what, in a sentence, above the twelve.
 *
 * The popover stays open after a pick: a colour is tried by looking at it,
 * and the dot on the button and every name in the room change at once.
 * Not optimistic, like the glasses: what shows as chosen is what the room has.
 */
export function ColourPicker({ memberId }: { memberId: string }) {
  const { t } = useT();
  const me = useMember(memberId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const chosen = me?.colour;
  const current = chosen ?? hashedColour(memberId);

  async function pick(next: number | null) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await setMyColour(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="colour-open"
          aria-label={t('you.colour')}
          title={t('you.colour')}
          className={cn(
            // A dot in a ring, a thumb's size: the whole control, so it fits
            // beside the name instead of costing the sheet a row.
            'grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border border-edge bg-transparent',
            'transition-colors duration-75 hover:border-accent',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <span
            aria-hidden="true"
            className="h-6 w-6 rounded-full"
            style={{ background: `var(--dad-${current})` }}
          />
          <span className="sr-only">{t('you.colour_open')}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={t('you.colour')}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'z-50 w-72 max-w-[var(--radix-popper-available-width)] rounded-[var(--radius-control)]',
            'border border-line bg-paper p-3 text-ink shadow-lg',
            'motion-pop origin-[var(--radix-popper-transform-origin)]',
          )}
        >
          {/* What it changes, said first: a colour on its own is a mystery
              until a dad has seen where it lands. */}
          <p className="m-0 mb-2 text-base text-muted" data-testid="colour-what">
            {t('you.colour_what')}
          </p>
          <div
            role="group"
            aria-label={t('you.colour')}
            className="grid grid-cols-6 gap-1"
            data-testid="colour-picker"
          >
            {Array.from({ length: DAD_COLOURS }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={current === n}
                aria-label={t(`colour.${n}` as 'colour.1')}
                title={t(`colour.${n}` as 'colour.1')}
                // Not `disabled`: that takes the focus off the one he pressed.
                aria-disabled={busy}
                onClick={() => void pick(n)}
                data-testid={`colour-${n}`}
                className={cn(
                  'grid h-11 w-full cursor-pointer place-items-center rounded-full border-2 bg-transparent',
                  current === n ? 'border-ink' : 'border-transparent',
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-7 w-7 rounded-full"
                  style={{ background: `var(--dad-${n})` }}
                />
              </button>
            ))}
          </div>
          {error ? (
            <p className="mt-2 mb-0 text-base text-danger" role="alert">
              {t('you.glasses_failed')}
            </p>
          ) : null}
          {chosen === undefined ? null : (
            <Button
              look="quiet"
              size="sm"
              className="mt-1 -ml-2"
              onClick={() => void pick(null)}
              data-testid="colour-auto"
            >
              {t('you.colour_auto')}
            </Button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
