/**
 * What a text field looks like.
 *
 * A string rather than a component: half the inputs in this app are already
 * wired to a label, an id and a handler, and wrapping them to change a border
 * would be a component that exists to hold a class name.
 */
export const FIELD = [
  // 16px, not 15: under 16px iOS zooms the whole page in when a field is
  // focused, and it does not zoom back out. py-2.5 puts the box at 44px, a
  // thumb's height.
  'w-full rounded-app border border-edge bg-paper px-3 py-2.5 text-base text-ink',
  'placeholder:text-muted/70',
  'transition-colors duration-75',
  'focus:border-accent focus:outline-2 focus:outline-offset-[-1px] focus:outline-accent',
  'disabled:opacity-50',
].join(' ');
