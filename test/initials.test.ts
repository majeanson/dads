import { describe, expect, it } from 'vitest';
import { initials } from '../src/web/initials';

describe('a dad with no face', () => {
  it('gets one letter for one name', () => {
    expect(initials('Marc')).toBe('M');
    expect(initials('Sam')).toBe('S');
  });

  it('treats a hyphen as one name and a space as two', () => {
    // The case this rule exists for: "Marc-antoine" is one man's first name,
    // and MA would read as two of them.
    expect(initials('Marc-antoine')).toBe('M');
    expect(initials('Marc Antoine')).toBe('MA');
  });

  it('takes the first and the LAST, not the first two', () => {
    // Jean Paul Tremblay is JT to everyone who knows him.
    expect(initials('Jean Paul Tremblay')).toBe('JT');
  });

  it('keeps an accent, because a name is spelled how it is spelled', () => {
    expect(initials('Émile')).toBe('É');
    expect(initials('Éric Côté')).toBe('ÉC');
  });

  it('never returns nothing', () => {
    // An empty circle is worse at telling five men apart than any letter.
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
    expect(initials('\n\t')).toBe('?');
  });

  it('survives whitespace nobody meant to type', () => {
    expect(initials('  Marc   Antoine  ')).toBe('MA');
  });

  it('takes whole code points, not half a surrogate pair', () => {
    // A name can begin outside the basic plane, and half a pair is a broken
    // glyph rather than a letter.
    expect(initials('𝒥ohn')).toBe('𝒥');
    expect([...initials('👨‍🍳 Dad')][0]).toBe('👨');
  });
});
