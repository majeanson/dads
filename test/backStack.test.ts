import { describe, expect, it } from 'vitest';
import { createBackStack, depthOf, type Nav } from '../src/web/backStack';

/**
 * A history that behaves like a browser's: push truncates forward, go() is
 * asynchronous and lands as a popstate. `settle()` delivers what is queued.
 */
function fakeHistory(start: unknown[] = [null]) {
  const entries: unknown[] = [...start];
  let at = entries.length - 1;
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
    get owed() {
      return owed;
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
    stack.popped(h.settle());
    expect(h.at).toBe(0);
    // And a layer back already closed does not travel twice.
    stack.open(() => {});
    h.nav.go(-1);
    stack.popped(h.settle());
    expect(h.at).toBe(0);
    expect(h.owed).toBe(0);
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
      stack.popped(h.settle());
      expect(h.at).toBe(0);
      expect(h.owed).toBe(0);
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

  it('a sheet opened before the last one has finished leaving waits for it', () => {
    // Close one, open the next in the same breath: the new sheet must not
    // push its entry on top of a back still in flight, and the landing of
    // that back must not close it.
    const h = fakeHistory();
    const stack = createBackStack(h.nav);
    let closed = 0;
    const first = stack.open(() => {});
    first.gone();
    stack.open(() => (closed += 1));
    expect(h.length).toBe(2);
    expect(h.at).toBe(1);

    stack.popped(h.settle());
    expect(closed).toBe(0);
    expect(stack.depth).toBe(1);
    // Now it has its own entry, and back takes it like any other.
    expect(h.at).toBe(1);
    expect(h.length).toBe(2);
    h.nav.go(-1);
    stack.popped(h.settle());
    expect(closed).toBe(1);
    expect(h.at).toBe(0);
  });

  it('a layer closed again before its entry ever existed asks for no travel', () => {
    const h = fakeHistory();
    const stack = createBackStack(h.nav);
    stack.open(() => {}).gone();
    const waiting = stack.open(() => {});
    waiting.gone();
    expect(h.owed).toBe(-1);
    stack.popped(h.settle());
    expect(h.at).toBe(0);
    expect(h.owed).toBe(0);
    expect(stack.depth).toBe(0);
  });

  it('a page that loads on a sheet entry goes back to the base', () => {
    const h = fakeHistory([null, { dadsLayers: 1 }, { dadsLayers: 2 }]);
    const stack = createBackStack(h.nav);
    stack.settle();
    // A sheet opened at once waits for that landing too.
    let closed = 0;
    stack.open(() => (closed += 1));
    expect(h.length).toBe(3);
    stack.popped(h.settle());
    expect(closed).toBe(0);
    expect(h.at).toBe(1);
    expect(h.length).toBe(2);
  });
});
