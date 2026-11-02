import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where a dad got to, per device.
 *
 * The mark everything about "how many are new" is derived from. It used to be
 * a tally that began each load at nought, which is why opening the app
 * announced a conversation he had already read — so the invariants here are
 * load-bearing, particularly that the mark never goes backwards.
 *
 * localStorage is stubbed because the worker pool has none, and because the
 * interesting cases are the ones a browser makes hard to reach: storage that
 * refuses, and a value somebody else wrote.
 */
const store = new Map<string, string>();
let refuse = false;

vi.stubGlobal('localStorage', {
  getItem: (k: string) => {
    if (refuse) throw new Error('storage is off');
    return store.get(k) ?? null;
  },
  setItem: (k: string, v: string) => {
    if (refuse) throw new Error('storage is full');
    store.set(k, v);
  },
});

const { lastSeen, markSeen, reconcile } = await import('../src/web/seen');

beforeEach(() => {
  store.clear();
  refuse = false;
});

describe('the mark', () => {
  it('is nothing at all for a dad who has never opened this room here', () => {
    expect(lastSeen('grp_1')).toBeNull();
  });

  it('remembers where he got to', () => {
    markSeen('grp_1', 42);
    expect(lastSeen('grp_1')).toBe(42);
  });

  it('is per group, so two rooms never read each other', () => {
    markSeen('grp_1', 42);
    markSeen('grp_2', 7);
    expect(lastSeen('grp_1')).toBe(42);
    expect(lastSeen('grp_2')).toBe(7);
    expect(lastSeen('grp_3')).toBeNull();
  });

  it('only ever moves forward', () => {
    // The whole point. A backfill that arrives out of order, or a second tab
    // further back in the conversation, must never make lines he has read
    // new again.
    markSeen('grp_1', 42);
    markSeen('grp_1', 10);
    expect(lastSeen('grp_1')).toBe(42);
    markSeen('grp_1', 43);
    expect(lastSeen('grp_1')).toBe(43);
  });

  it('ignores anything that is not a sequence number', () => {
    for (const junk of ['', 'lots', '0', '-3', 'NaN', '{}']) {
      store.set('dads.seen.grp_1', junk);
      expect(lastSeen('grp_1'), junk).toBeNull();
    }
  });

  it('says nothing rather than throwing when storage refuses', () => {
    // A private window, blocked site data, a full disk. He loses the divider
    // on that device; the room still works.
    refuse = true;
    expect(() => markSeen('grp_1', 42)).not.toThrow();
    expect(lastSeen('grp_1')).toBeNull();
  });
});

describe('this device and the room, as one mark', () => {
  it('takes whichever got further: he read that far on one of his devices', () => {
    expect(reconcile(12, 30)).toBe(30);
    expect(reconcile(30, 12)).toBe(30);
    expect(reconcile(30, 30)).toBe(30);
  });

  it('takes the one there is when the other has nothing to say', () => {
    // No socket yet, or a room that has never had a mark from him.
    expect(reconcile(12, null)).toBe(12);
    // A device new to a dad who has read elsewhere starts where he got to.
    expect(reconcile(null, 30)).toBe(30);
  });

  it('is nothing when neither knows, not nought', () => {
    // Null is what makes a brand-new dad start at the newest line rather than
    // at the bottom of the archive; nought would count every line as new.
    expect(reconcile(null, null)).toBeNull();
    expect(reconcile(0, null)).toBe(0);
  });
});
