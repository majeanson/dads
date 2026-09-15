/**
 * What a text field looks like.
 *
 * A string rather than a component: half the inputs in this app are already
 * wired to a label, an id and a handler, and wrapping them to change a border
 * would be a component that exists to hold a class name.
 */
export const FIELD = [
  // 17px, above the 16 under which iOS zooms the whole page in on focus and
  // does not zoom it back out. A `min-height` rather than a height, because
  // the same class dresses a textarea: 3.25rem is the `lg` Button beside it,
  // on the same radius, so a field and its Add or Save read as one row.
  'w-full min-h-13 rounded-[var(--radius-control)] border border-edge bg-paper px-4 py-2.5 text-[1.0625rem] text-ink',
  'placeholder:text-muted/70',
  'transition-colors duration-75',
  'focus:border-accent focus:outline-2 focus:outline-offset-[-1px] focus:outline-accent',
  'disabled:opacity-50',
].join(' ');
