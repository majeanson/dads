/**
 * What a text field looks like.
 *
 * A string rather than a component: half the inputs in this app are already
 * wired to a label, an id and a handler, and wrapping them to change a border
 * would be a component that exists to hold a class name.
 */
export const FIELD = [
  'w-full rounded-app border border-edge bg-paper px-3 py-2 text-[0.9375rem] text-ink',
  'placeholder:text-muted/70',
  'transition-colors duration-75',
  'focus:border-accent focus:outline-2 focus:outline-offset-[-1px] focus:outline-accent',
  'disabled:opacity-50',
].join(' ');
