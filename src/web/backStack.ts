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
 * other way travels back over its entry so the history never grows. Nothing
 * here is a route: the URL does not change and home is still a view
 * (`data-view`), not an address.
 *
 * `history.go` is asynchronous, and that is the one thing to be careful of.
 * A sheet closed and the next one opened in the same breath (the a11y suite
 * does exactly this) would push the new entry on top of a traversal still
 * in flight, and the traversal then lands on the base and pops the new sheet
 * shut. So while a traversal of ours is pending, a layer that opens is held
 * back from the history (`entered` false) and gets its entry when the
 * landing arrives. Until then a press of back takes it, which is right.
 *
 * The pure half, so the unit suite can drive it with a fake history. The
 * hook that binds it to `window.history` is `useBackCloses`.
 */

/** The three things this needs from `window.history`. */
export interface Nav {
  state(): unknown;
  push(state: unknown): void;
  /** Re-stamp the entry we are on, without moving. */
  replace(state: unknown): void;
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
    /** Back took it: its entry is already gone. */
    popped: boolean;
    /** It has an entry in the history. */
    entered: boolean;
  }
  const stack: Open[] = [];
  /** Traversals we asked for that have not landed as a popstate yet. */
  let travelling = 0;
  // Where we believe the history is, counted in layers. Moves when we ask,
  // not when the popstate lands: two layers unmounting together each travel
  // over their own entry.
  let position = depthOf(nav.state());

  function travel(steps: number) {
    travelling += 1;
    position += steps;
    nav.go(steps);
  }

  /** Give every layer still without an entry its own, in order. */
  function enter() {
    stack.forEach((layer, i) => {
      if (layer.entered) return;
      layer.entered = true;
      position = i + 1;
      nav.push({ [KEY]: i + 1 });
    });
  }

  return {
    /** A layer opened: push its entry. `close` is what back does to it. */
    open(close: () => void): Layer {
      const layer: Open = { close, popped: false, entered: false };
      stack.push(layer);
      if (travelling === 0) enter();
      return {
        gone() {
          const at = stack.indexOf(layer);
          if (at === -1) return;
          stack.splice(at, 1);
          if (layer.popped || !layer.entered) return;
          // Back over its own entry — never forward, and never past
          // somebody else's travel that has already been asked for.
          if (position > at) travel(at - position);
        },
      };
    },

    /** A popstate landed on `state`: close everything above its depth. */
    popped(state: unknown) {
      const depth = depthOf(state);
      if (travelling > 0) travelling -= 1;
      position = depth;
      // Top first, so a viewer over a sheet goes before the sheet. Layers
      // with no entry yet are above every entered one and are not in the
      // history being popped: our own landing leaves them alone.
      const closing = stack.filter((layer, i) => layer.entered && i >= depth);
      for (const layer of closing.reverse()) {
        stack.splice(stack.indexOf(layer), 1);
        layer.popped = true;
        layer.close();
      }
      if (travelling === 0) enter();
    },

    /**
     * The page loaded on one of our entries (a reload with a sheet open):
     * travel back to the base so the first back is still the one that leaves.
     */
    settle() {
      const stale = depthOf(nav.state());
      if (stale > 0) travel(-stale);
    },

    /**
     * A traversal we asked for never landed. It happens: a restored tab whose
     * one entry carries our stamp has nothing behind it, and `go(-1)` there
     * fires no popstate at all. Waiting for ever would hold every layer out
     * of the history, which is the bug this module was written against. So
     * the hook gives a landing a moment, and then calls this: nothing is in
     * flight, and the layers waiting get their entries now.
     */
    lost() {
      travelling = 0;
      // Where we are is the base after all, whatever its stamp says: a stale
      // stamp left on it would make the next back land on "one layer open"
      // and close nothing.
      position = 0;
      nav.replace(null);
      enter();
    },

    /** How many layers are open; for tests. */
    get depth() {
      return stack.length;
    },
  };
}
