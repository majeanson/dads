/**
 * The first frame, painted by index.html before any script has run.
 *
 * On a phone the bundle takes more than a second to arrive and run, and
 * until it has there was nothing on the screen at all. The shell is the
 * splash's own first frame — the accent ground and the face, where the
 * splash starts — so the app has a face at the first paint and the splash
 * takes over from it without a seam. It stays up until the app knows
 * whether this is the door or the room; taking it down any earlier showed
 * the "…" of a session still loading between two blue screens.
 */
const SHELL_ID = 'shell';

/** Whether the shell is still on the screen: only ever on the first load. */
export function shellUp(): boolean {
  return typeof document !== 'undefined' && document.getElementById(SHELL_ID) !== null;
}

/**
 * Take the shell down. It fades rather than cuts, so the door arrives
 * rather than appears; over the splash, which starts on the same frame,
 * the fade shows nothing at all.
 */
export function dropShell(): void {
  const el = document.getElementById(SHELL_ID);
  if (el === null || el.dataset.gone !== undefined) return;
  el.dataset.gone = '';
  const remove = () => el.remove();
  el.addEventListener('transitionend', remove, { once: true });
  // A transition that never runs (a hidden tab, reduced motion) never ends.
  setTimeout(remove, 400);
}
