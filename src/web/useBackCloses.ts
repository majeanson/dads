import { useEffect, useRef } from 'react';
import { createBackStack } from './backStack';

/** Bind the back stack to the one browser history. See `backStack.ts`. */
const stack = createBackStack({
  state: () => history.state,
  push: (state) => history.pushState(state, ''),
  go: (steps) => history.go(steps),
});
window.addEventListener('popstate', (event) => stack.popped(event.state));
stack.settle();

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
