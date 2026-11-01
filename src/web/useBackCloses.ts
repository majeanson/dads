import { useEffect, useRef } from 'react';
import { createBackStack, depthOf } from './backStack';

/**
 * Bind the back stack to the one browser history. See `backStack.ts`.
 *
 * A reload with a sheet open (a fresh build waking a home-screen app) lands
 * on that sheet's entry with nothing open: travel back to the base at once,
 * so the first press of back is still the one that leaves.
 */
const stack = createBackStack({
  state: () => history.state,
  push: (state) => history.pushState(state, ''),
  go: (steps) => history.go(steps),
});
const stale = depthOf(history.state);
if (stale > 0) history.go(-stale);
window.addEventListener('popstate', (event) => stack.popped(event.state));

/**
 * While `open`, the phone's back button calls `onClose` instead of leaving
 * the app. Closing any other way tidies the entry away.
 */
export function useBackCloses(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const layer = stack.open(() => closeRef.current());
    return () => layer.gone();
  }, [open]);
}
