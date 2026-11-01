/**
 * The phone's back button, for things that open over the room.
 *
 * The app is one page, and until this it was one history entry. On Android
 * the back button is how a man closes anything — and with nothing behind the
 * page, a photo open full screen (or a sheet) and a press of back closed the
 * whole app instead of the picture. The first report was exactly that.
 *
 * So every layer that opens over the room — a sheet, the viewer — pushes one
 * history entry, stamped with how many layers are open at that point. Back
 * pops the entry and the layers above that depth close; closing a layer any
 * other way (X, Escape, its own button) travels back over its entry so the
 * history never grows. Nothing here is a route: the URL does not change and
 * home is still a view (`data-view`), not an address.
 *
 * The pure half, so the unit suite can drive it with a fake history. The
 * hook that binds it to `window.history` is `useBackCloses`.
 */

/** The three things this needs from `window.history`. */
export interface Nav {
  state(): unknown;
  push(state: unknown): void;
  go(steps: number): void;
}

/** What is stamped on each entry we push. */
const KEY = 'dadsLayers';

/** How many layers an entry says are open; the base (or anybody else's state) is 0. */
export function depthOf(state: unknown): number {
  if (typeof state !== 'object' || state === null) return 0;
  const n = (state as Record<string, unknown>)[KEY];
  return typeof n === 'number' && n > 0 ? n : 0;
}

export interface Layer {
  /** The layer is unmounting: pop its entry unless back already did. */
  gone(): void;
}

export function createBackStack(nav: Nav) {
  interface Open {
    close: () => void;
    popped: boolean;
  }
  const stack: Open[] = [];
  // Where we believe the history is, counted in layers. `go()` is
  // asynchronous, so this moves when we ask, not when the popstate lands:
  // two layers unmounting together each travel over their own entry.
  let position = depthOf(nav.state());

  return {
    /** A layer opened: push its entry. `close` is what back does to it. */
    open(close: () => void): Layer {
      const layer: Open = { close, popped: false };
      stack.push(layer);
      position = stack.length;
      nav.push({ [KEY]: stack.length });
      return {
        gone() {
          const at = stack.indexOf(layer);
          if (at === -1) return;
          stack.splice(at, 1);
          if (layer.popped) return;
          // Back over its own entry — never forward, and never past
          // somebody else's travel that has already been asked for.
          if (position > at) {
            nav.go(at - position);
            position = at;
          }
        },
      };
    },

    /** A popstate landed on `state`: close everything above its depth. */
    popped(state: unknown) {
      const depth = depthOf(state);
      position = depth;
      // Top first, so a viewer over a sheet goes before the sheet.
      const closing = stack.splice(depth);
      for (const layer of closing.reverse()) {
        layer.popped = true;
        layer.close();
      }
    },

    /** How many layers are open; for tests. */
    get depth() {
      return stack.length;
    },
  };
}
