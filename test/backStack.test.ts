import { describe, expect, it } from 'vitest';
import { createBackStack, depthOf, type Nav } from '../src/web/backStack';

/**
 * A history that behaves like a browser's: push truncates forward, go() is
 * asynchronous and lands as a popstate. `settle()` delivers what is queued.
 */
function fakeHistory() {
  const entries: unknown[] = [null];
  let at = 0;
  let owed = 0;
  const nav: Nav = {
    state: () => entries[at],
    push(state) {
      entries.splice(at + 1);
      entries.push(state);
      at += 1;
    },
    go(steps) {
      owed += steps;
    },
  };
  return {
    nav,
    /** Deliver the queued travel; returns the state landed on. */
    settle(): unknown {
      at = Math.max(0, Math.min(entries.length - 1, at + owed));
      owed = 0;
      return entries[at];
    },
    get length() {
      return entries.length;
    },
    get at() {
      return at;
    },
  };
}

describe('depthOf', () => {
  it('reads only our own stamp', () => {
    expect(depthOf(null)).toBe(0);
    expect(depthOf({ other: 3 })).toBe(0);
    expect(depthOf({ dadsLayers: 2 })).toBe(2);
    expect(depthOf({ dadsLayers: -1 })).toBe(0);
  });
});

describe('back stack', () => {
  it('back closes the open layer instead of leaving', () => {
    const h = fakeHistory();
    const stack = createBackStack(h.nav);
    let closed = 0;
    stack.open(() => (closed += 1));
    expect(h.length).toBe(2);

    // The phone's back button: the entry pops and the layer is told.
    h.nav.go(-1);
    stack.popped(h.settle());
    expect(closed).toBe(1);
    expect(h.at).toBe(0);
  });

  it('closing any other way travels back over its entry', () => {
    const h = fakeHistory();
    const stack = createBackStack(h.nav);
    const layer = stack.open(() => {});
    layer.gone();
    expect(h.settle()).toBeNull();
    expect(h.at).toBe(0);
    // And a layer back already closed does not travel twice.
    stack.open(() => {});
    h.nav.go(-1);
    stack.popped(h.settle());
    expect(h.at).toBe(0);
  });

  it('a viewer over a sheet: back takes the top only', () => {
    const h = fakeHistory();
    const stack = createBackStack(h.nav);
    const order: string[] = [];
    const sheet = stack.open(() => order.push('sheet'));
    const viewer = stack.open(() => order.push('viewer'));
    expect(h.length).toBe(3);

    h.nav.go(-1);
    stack.popped(h.settle());
    expect(order).toEqual(['viewer']);
    viewer.gone();
    expect(stack.depth).toBe(1);

    h.nav.go(-1);
    stack.popped(h.settle());
    expect(order).toEqual(['viewer', 'sheet']);
    sheet.gone();
    expect(h.at).toBe(0);
  });

  it('two layers unmounting together land on the base, in either order', () => {
    for (const parentFirst of [false, true]) {
      const h = fakeHistory();
      const stack = createBackStack(h.nav);
      const sheet = stack.open(() => {});
      const viewer = stack.open(() => {});
      if (parentFirst) {
        sheet.gone();
        viewer.gone();
      } else {
        viewer.gone();
        sheet.gone();
      }
      expect(h.settle()).toBeNull();
      expect(h.at).toBe(0);
    }
  });

  it('a long press of back closes everything above the base at once', () => {
    const h = fakeHistory();
    const stack = createBackStack(h.nav);
    const order: string[] = [];
    stack.open(() => order.push('sheet'));
    stack.open(() => order.push('viewer'));
    h.nav.go(-2);
    stack.popped(h.settle());
    expect(order).toEqual(['viewer', 'sheet']);
    expect(stack.depth).toBe(0);
  });
});
