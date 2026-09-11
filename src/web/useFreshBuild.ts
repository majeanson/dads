import { useEffect, useRef } from 'react';
import { bundleOf, isNewer } from './fresh';

// Once a minute at most: a dad switching between two apps in a kitchen is not
// a reason to fetch the door six times.
const AT_MOST_EVERY_MS = 60_000;

/**
 * A dad on the home screen gets the new version without being told to.
 *
 * Coming back to the foreground is the moment to ask — see `fresh.ts` for
 * why a home-screen app is the case that needs asking. The reload is held
 * back while he is in the middle of something — a line half typed, a voice
 * note recording, a call — because a new version is never worth a dropped
 * call; it happens the next time he comes back with his hands free.
 *
 * A cold load is not asked about: it IS the newest build. `pageshow` counts
 * only when the page came back out of the browser's cache, which is the other
 * way an old page wakes up.
 */
export function useFreshBuild(busy: boolean): void {
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const running = bundleOf(document.documentElement.outerHTML);
    if (running === null) return;

    let last = 0;
    let stale = false;

    async function check() {
      if (document.hidden) return;
      if (stale) {
        if (!busyRef.current) location.reload();
        return;
      }
      const now = Date.now();
      if (now - last < AT_MOST_EVERY_MS) return;
      last = now;
      try {
        const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
        if (!res.ok) return;
        if (!isNewer(running, bundleOf(await res.text()))) return;
      } catch {
        // No network is no news. The next return to the app asks again.
        return;
      }
      stale = true;
      if (!busyRef.current) location.reload();
    }

    const onVisible = () => void check();
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);
}
