import { describe, expect, it } from 'vitest';
import { cryptoRandom, roomWord } from '../src/shared/roomWord';

describe('a word for a new room', () => {
  it('is two plain words and three digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(roomWord(cryptoRandom)).toMatch(/^[a-z]+-[a-z]+-[1-9]\d{2}$/);
    }
  });

  it('clears the floor every room is held to, and the ceiling', () => {
    for (let i = 0; i < 200; i++) {
      const length = [...roomWord(cryptoRandom)].length;
      expect(length).toBeGreaterThanOrEqual(4);
      expect(length).toBeLessThanOrEqual(64);
    }
  });

  it('takes its randomness from the caller and stays inside every list', () => {
    expect(roomWord(() => 0)).toBe('amber-badger-100');
    const top = roomWord((max) => max - 1);
    expect(top).toMatch(/^[a-z]+-[a-z]+-999$/);
  });

  it('does not hand out the same word twice in a row', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(roomWord(cryptoRandom));
    expect(seen.size).toBeGreaterThan(45);
  });
});
