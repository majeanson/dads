import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FRESH_MS, lastView, rememberView } from '../src/web/viewMemory';

/** Which side of the room a dad was on, per device and per group. */
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

beforeEach(() => {
  store.clear();
  refuse = false;
});

describe('viewMemory', () => {
  it('opens on home with nothing remembered', () => {
    expect(lastView('g1')).toBe('home');
  });

  it('returns to the conversation soon after leaving it there', () => {
    rememberView('g1', 'talk', 1_000);
    expect(lastView('g1', 1_000 + FRESH_MS - 1)).toBe('talk');
  });

  it('starts on home again once it has been a while', () => {
    rememberView('g1', 'talk', 1_000);
    expect(lastView('g1', 1_000 + FRESH_MS)).toBe('home');
  });

  it('remembers home as home', () => {
    rememberView('g1', 'talk', 1_000);
    rememberView('g1', 'home', 2_000);
    expect(lastView('g1', 3_000)).toBe('home');
  });

  it('keeps each room to itself', () => {
    rememberView('g1', 'talk', 1_000);
    expect(lastView('g2', 2_000)).toBe('home');
  });

  it('survives storage that refuses or holds nonsense', () => {
    store.set('dads.view.g1', 'talk@banana');
    expect(lastView('g1')).toBe('home');
    refuse = true;
    expect(() => rememberView('g1', 'talk')).not.toThrow();
    expect(lastView('g1')).toBe('home');
  });
});
