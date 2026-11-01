import { useEffect, useRef } from 'react';
import { createBackStack } from './backStack';
import { isIOS } from './push';

/**
 * Bind the back stack to the one browser history. See `backStack.ts`.
 *
 * Not on an iPhone (Marc, 2026-11-01). The entries exist for a back button,
 * and an iPhone has none — what it has is Safari's swipe from the left edge,
 * which walks the history, and with entries to walk it slid the whole
 * screen sideways like a web page going back and ate the swipe that was
 * meant as a reply. With no entries there is nothing to swipe back to, which
 * is how it was before and what an app feels like there.
 */
const backless = isIOS();
const stack = createBackStack({
  state: () => history.state,
  push: (state) => history.pushState(state, ''),
  go: (steps) => history.go(steps),
});
if (!backless) {
  window.addEventListener('popstate', (event) => stack.popped(event.state));
  stack.settle();
}

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
    if (!open || backless) return;
    const layer = stack.open(() => closeRef.current());
    return () => layer.gone();
  }, [open]);
}
