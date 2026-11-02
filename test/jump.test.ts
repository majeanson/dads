import { describe, expect, it } from 'vitest';
import { isFarUp, jumpLook } from '../src/web/jump';

/** The way back down (Marc asked, 2026-11-02). */
describe('far up', () => {
  it('is more than a screen above the bottom, and no less', () => {
    expect(isFarUp({ scrollHeight: 3000, scrollTop: 0, clientHeight: 600 })).toBe(true);
    // Exactly a screen up is still within reach of a flick.
    expect(isFarUp({ scrollHeight: 3000, scrollTop: 1800, clientHeight: 600 })).toBe(false);
    expect(isFarUp({ scrollHeight: 3000, scrollTop: 1799, clientHeight: 600 })).toBe(true);
    expect(isFarUp({ scrollHeight: 3000, scrollTop: 2300, clientHeight: 600 })).toBe(false);
    expect(isFarUp({ scrollHeight: 3000, scrollTop: 2400, clientHeight: 600 })).toBe(false);
  });

  it('a list with no height yet (hidden behind home) is not far from anything', () => {
    expect(isFarUp({ scrollHeight: 0, scrollTop: 0, clientHeight: 0 })).toBe(false);
  });
});

describe('the button down', () => {
  it('says nothing at the bottom, whatever else is true', () => {
    expect(jumpLook({ pinned: true, unseen: 3, farUp: true })).toBe('none');
  });

  it('counts what is new, near or far', () => {
    expect(jumpLook({ pinned: false, unseen: 1, farUp: false })).toBe('count');
    expect(jumpLook({ pinned: false, unseen: 2, farUp: true })).toBe('count');
  });

  it('is the bare arrow only from far up with nothing new', () => {
    expect(jumpLook({ pinned: false, unseen: 0, farUp: true })).toBe('arrow');
    expect(jumpLook({ pinned: false, unseen: 0, farUp: false })).toBe('none');
  });
});
