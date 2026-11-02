import { describe, expect, it } from 'vitest';
import { parseTextSize, textAttribute, TEXT_SIZES } from '../src/web/textSizeValue';

/** The text size a device stored, read back. */
describe('parseTextSize', () => {
  it('reads the three sizes it knows', () => {
    for (const size of TEXT_SIZES) expect(parseTextSize(size)).toBe(size);
  });

  it('is the normal size for anything else', () => {
    for (const value of [null, undefined, '', 'huge', 'LARGE', ' large', 1.25, {}]) {
      expect(parseTextSize(value)).toBe('normal');
    }
  });
});

describe('textAttribute', () => {
  it('puts nothing on the page at the normal size', () => {
    expect(textAttribute('normal')).toBeNull();
    expect(textAttribute('large')).toBe('large');
    expect(textAttribute('larger')).toBe('larger');
  });
});
