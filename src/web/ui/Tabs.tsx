import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * Two or three views of one thing, one on the screen at a time.
 *
 * Radix for the keyboard route and the roles; the look is the kit's: a row of
 * plain controls on the control radius, the chosen one filled with the accent
 * the way a chosen rating is. Not a tab STRIP over the room — that decision
 * stands — this is inside a sheet, where "this week" and "before" really are
 * two views of the same board.
 */
export function Tabs({
  value,
  onChange,
  tabs,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  tabs: { value: string; label: string; testId?: string }[];
  /** What the row of tabs is a choice between, for a screen reader. */
  label: string;
  children: ReactNode;
}) {
  return (
    <RadixTabs.Root value={value} onValueChange={onChange} className="grid gap-4">
      <RadixTabs.List aria-label={label} className="grid auto-cols-fr grid-flow-col gap-2">
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            data-testid={tab.testId}
            className={cn(
              'h-11 cursor-pointer rounded-[var(--radius-control)] border px-3 text-base font-medium',
              'transition-colors duration-75',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'border-edge bg-panel text-muted hover:border-accent hover:text-accent',
              'data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-on-accent',
            )}
          >
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export function TabPanel({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixTabs.Content value={value} className={cn('outline-none', className)}>
      {children}
    </RadixTabs.Content>
  );
}
