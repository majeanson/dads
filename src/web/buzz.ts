/**
 * A tap you can feel, on the phones that can.
 *
 * Android vibrates for a few milliseconds; an iPhone has no web API for it and
 * this does nothing there, which is fine — it is a confirmation, never the
 * only one. Guarded, because a browser that has the method can still refuse.
 */
export function buzz(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Nothing to do: the mark is on the screen either way.
  }
}
