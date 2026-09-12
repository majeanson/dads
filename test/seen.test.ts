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

const { lastSeen, markSeen } = await import('../src/web/seen');

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
