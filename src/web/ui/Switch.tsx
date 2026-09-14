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
        // A row a thumb hits without aiming: 56px, the same as a menu row.
        'flex min-h-14 cursor-pointer items-center justify-between gap-3 border-b border-line py-2.5',
        'transition-colors duration-75',
        checked ? 'text-ink' : 'text-muted',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="text-[1.0625rem]">{label}</span>
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        data-testid={testId}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-100',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          checked ? 'border-accent bg-accent' : 'border-edge bg-panel',
        )}
      >
        <RadixSwitch.Thumb
          className={cn(
            'block h-4 w-4 rounded-full bg-paper shadow-sm transition-transform duration-100',
            'translate-x-1 data-[state=checked]:translate-x-6',
          )}
        />
      </RadixSwitch.Root>
    </label>
  );
}
