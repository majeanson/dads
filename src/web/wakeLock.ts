import { useEffect } from 'react';

/**
 * Keeps the screen on while a call is going.
 *
 * A phone dims and locks after half a minute of nobody touching it, which is
 * exactly what a dad does while he is listening to his mates. The lock is
 * dropped the moment the call ends, and the browser drops it itself whenever
 * the tab goes to the background — so it has to be taken again on the way
 * back, which is what the visibility listener is for.
 *
 * Not supported everywhere and not worth a word to anyone when it is missing:
 * a screen that dims is a nuisance, not a failure.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let dropped = false;

    const take = async () => {
      if (dropped || document.hidden || lock !== null) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        // Taken away by the system rather than by us: forget it so the next
        // return to the tab asks again.
        lock.addEventListener('release', () => {
          lock = null;
        });
      } catch {
        // Refused, or the battery is too low for the browser to allow it.
      }
    };

    const onVisible = () => void take();
    document.addEventListener('visibilitychange', onVisible);
    void take();

    return () => {
      dropped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [active]);
}
