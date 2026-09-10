import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class names, merged so the last one wins.
 *
 * `clsx` flattens the conditionals; `tailwind-merge` resolves the collisions —
 * without it a `className` passed into a component sits alongside the
 * component's own and whichever Tailwind emitted later wins, which is not the
 * one the caller asked for.
 */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
