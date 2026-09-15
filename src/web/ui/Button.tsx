import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/**
 * The one button.
 *
 * Every control in the app comes through here, so "what a button looks like"
 * is a decision made once — and pressed, focused, disabled and hovered are
 * decided with it rather than four times over.
 *
 * `cva` for the variants because a component with five booleans is a component
 * nobody can read; each variant is a row you can point at.
 */
const button = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-app font-medium',
    'cursor-pointer select-none whitespace-nowrap',
    // A press should feel like one. 75ms is under the threshold where a
    // transition reads as an animation rather than as the thing responding.
    'transition-[background-color,border-color,color,box-shadow,transform] duration-75',
    'active:translate-y-px',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      look: {
        /** What most things are: an outline that darkens under a finger. */
        plain: 'border border-edge bg-panel text-ink hover:border-accent hover:text-accent',
        /** The one thing on the screen you are most likely to want. */
        primary:
          'border border-accent bg-accent text-on-accent shadow-sm hover:brightness-110 active:brightness-95',
        /** A control that should not compete: still a control, no box. */
        quiet: 'text-muted hover:text-ink',
        /** Taking something away. */
        danger: 'border border-line text-muted hover:border-danger hover:text-danger',
      },
      size: {
        sm: 'h-8 px-2.5 text-sm',
        /* 44px, which is the number this app already says a thumb is — the
           composer's controls and the header's icons were each given it by
           hand while the default stayed at 40. */
        md: 'h-11 px-4 text-base',
        /** The one action on a sheet, and home's answers: a thumb's height and
           a half, on the control radius the menu rows and home already share,
           so the biggest thing on a screen is the one a finger goes to. */
        lg: 'h-13 rounded-[var(--radius-control)] px-5 text-[1.0625rem]',
        /** Square, for a control that is an icon and nothing else — and a
           thumb's square, not four pixels under it. */
        icon: 'h-11 w-11 p-0',
        iconSm: 'h-7 w-7 p-0 text-sm',
      },
      /** Fills its row, for a list of choices. */
      block: { true: 'w-full justify-start', false: '' },
    },
    defaultVariants: { look: 'plain', size: 'md', block: false },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & { children?: ReactNode };

export function Button({ className, look, size, block, type, ...rest }: ButtonProps) {
  return (
    // Typed explicitly rather than left to default: a button inside a form
    // with no type is a submit button, which is how a "cancel" sends a form.
    <button
      type={type ?? 'button'}
      className={cn(button({ look, size, block }), className)}
      {...rest}
    />
  );
}
