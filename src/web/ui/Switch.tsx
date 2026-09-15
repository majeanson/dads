import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from './cn';

/**
 * On or off, and it looks like it.
 *
 * A row you press anywhere along: the label is part of the control, because a
 * 40-pixel switch beside a full-width word is a target most thumbs miss.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label
      className={cn(
        // A row a thumb hits without aiming: 64px, the same as a menu row.
        'flex min-h-16 cursor-pointer items-center justify-between gap-3 border-b border-line py-2.5',
        'transition-colors duration-75',
        checked ? 'text-ink' : 'text-muted',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="text-[1.125rem]">{label}</span>
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        data-testid={testId}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full border transition-colors duration-100',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          checked ? 'border-accent bg-accent' : 'border-edge bg-panel',
        )}
      >
        <RadixSwitch.Thumb
          className={cn(
            'block h-5 w-5 rounded-full bg-paper shadow-sm transition-transform duration-100',
            // 4px in from either end of a 48px track with a 1px border.
            'translate-x-1 data-[state=checked]:translate-x-[1.375rem]',
          )}
        />
      </RadixSwitch.Root>
    </label>
  );
}
