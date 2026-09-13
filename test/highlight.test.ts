import { describe, expect, it } from 'vitest';
import { highlight } from '../src/shared/highlight';

/**
 * The word he searched for, marked in the line that carries it.
 *
 * Pieces rather than markup, like `linkify`: the point of the test is that a
 * dad who searches for something that looks like a tag gets his own text
 * back, and that the pieces always reassemble into exactly the line.
 */
const whole = (body: string, needle: string) =>
  highlight(body, needle)
    .map((p) => p.text)
    .join('');

describe('highlight', () => {
  it('marks the match and leaves the rest alone', () => {
    expect(highlight('bedtime is hard', 'time')).toEqual([
      { text: 'bed', hit: false },
      { text: 'time', hit: true },
      { text: ' is hard', hit: false },
    ]);
  });

  it('is case-insensitive, and keeps the case he wrote', () => {
    expect(highlight('Bedtime', 'bed')).toEqual([
      { text: 'Bed', hit: true },
      { text: 'time', hit: false },
    ]);
  });

  it('marks every occurrence', () => {
    expect(highlight('no no no', 'no').filter((p) => p.hit)).toHaveLength(3);
  });

  it('marks a match at either end', () => {
    expect(highlight('abc', 'abc')).toEqual([{ text: 'abc', hit: true }]);
    expect(highlight('abc', 'a')[0]).toEqual({ text: 'a', hit: true });
    expect(highlight('abc', 'c').at(-1)).toEqual({ text: 'c', hit: true });
  });

  it('never loses a character of the line', () => {
    for (const [body, needle] of [
      ['bedtime is hard', 'time'],
      ['no no no', 'no'],
      ['nothing matches', 'zzz'],
      ['', 'zzz'],
      ['keep it all', ''],
    ] as const) {
      expect(whole(body, needle)).toBe(body);
    }
  });

  it('takes the needle literally — it is a dad’s typing, not a pattern', () => {
    expect(highlight('a.c and abc', '.').filter((p) => p.hit)).toEqual([{ text: '.', hit: true }]);
    expect(highlight('costs $5 (ish)', '(ish)').filter((p) => p.hit)).toHaveLength(1);
    expect(highlight('<b>not bold</b>', '<b>')).toEqual([
      { text: '<b>', hit: true },
      { text: 'not bold</b>', hit: false },
    ]);
  });

  it('marks nothing for an empty needle', () => {
    expect(highlight('anything', '')).toEqual([{ text: 'anything', hit: false }]);
  });

  it('leaves a line alone rather than slicing it wrong', () => {
    // `İ` lowercases to two characters, so an offset found in the lowered
    // string no longer points at the same place in the original. Every piece
    // after it would be cut one position out; the line is shown unmarked
    // instead, which is a search that found it and did not mark it rather
    // than a line with its letters rearranged.
    const body = 'İstanbul and the rest of it';
    expect(highlight(body, 'rest')).toEqual([{ text: body, hit: false }]);
    // The needle's own lowering counts the same way.
    expect(highlight('plain enough', 'İ')).toEqual([{ text: 'plain enough', hit: false }]);
  });
});
