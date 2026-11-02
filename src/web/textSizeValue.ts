/**
 * How big the words are on this phone: the pure half of `textSize.ts`, so the
 * worker pool can test it without React.
 *
 * Marc asked (2026-11-01): a dad with older eyes can make the words bigger.
 * A home-screen web app ignores the phone's own text size, so this is the only
 * way he gets it. Three sizes, not a slider: each one is a step he can see,
 * and the screens were measured at each.
 */
export type TextSize = 'normal' | 'large' | 'larger';

export const TEXT_SIZES: readonly TextSize[] = ['normal', 'large', 'larger'];

/** Where this device keeps it. `index.html`'s pre-paint script reads the same key. */
export const TEXT_STORAGE = 'dads.text';

/**
 * What a stored value means. Anything this build does not know — nothing
 * stored, a value from a later build, a hand-edited one — is the normal size,
 * which is the app as it always was.
 */
export function parseTextSize(value: unknown): TextSize {
  return value === 'large' || value === 'larger' ? value : 'normal';
}

/** What goes on `<html data-text>`: nothing at the normal size. */
export function textAttribute(size: TextSize): string | null {
  return size === 'normal' ? null : size;
}
