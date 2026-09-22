import * as Popover from '@radix-ui/react-popover';
import { SmilePlus } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../i18n';
import { Button } from './Button';

/**
 * Thirty-two emoji and nothing else: no search, no categories, no skin
 * tones, no recents. The five marks first, then what five men in five
 * kitchens actually type. A phone has a keyboard for this, so the button is
 * only offered where there is a mouse; on a phone the keyboard's own emoji
 * key is the picker and a second one would be a fourth control on the row.
 */
export const EMOJI = [
  '👍',
  '❤️',
  '😂',
  '💪',
  '🙏',
  '😊',
  '😅',
  '😉',
  '😍',
  '😎',
  '🤣',
  '😭',
  '😤',
  '🙄',
  '😴',
  '🤔',
  '👀',
  '🔥',
  '🎉',
  '👌',
  '✌️',
  '🤝',
  '👏',
  '🍺',
  '☕',
  '🍕',
  '🏒',
  '⚽',
  '🎮',
  '🃏',
  '⏰',
  '👶',
] as const;

export function EmojiPicker({
  onPick,
  className,
}: {
  onPick: (emoji: string) => void;
  className?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          look="quiet"
          size="icon"
          className={className}
          aria-label={t('composer.emoji')}
          data-testid="emoji"
          // Like Send: the field keeps focus, so the emoji lands where the
          // caret was rather than at the end of a line he was editing.
          onMouseDown={(e) => e.preventDefault()}
        >
          <SmilePlus size={18} aria-hidden="true" />
          <span className="sr-only">{t('composer.emoji')}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          // And on the way out: Radix would hand focus back to the button, and
          // the field is where he was.
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-label={t('composer.emoji')}
          className={[
            'z-50 grid grid-cols-8 gap-0.5 rounded-lg border border-line bg-paper p-1.5 shadow-lg',
            'motion-pop origin-[var(--radix-popper-transform-origin)]',
          ].join(' ')}
          data-testid="emoji-picker"
        >
          {EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={emoji}
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-app border border-transparent text-lg transition-colors duration-75 hover:border-edge"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
