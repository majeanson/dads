import { describe, expect, it } from 'vitest';
import { parts } from '../src/shared/linkify';

describe('links in a message', () => {
  it('leaves a plain sentence alone', () => {
    expect(parts('rough bedtime tonight')).toEqual([
      { link: false, text: 'rough bedtime tonight' },
    ]);
  });

  it('finds one in the middle of a sentence', () => {
    expect(parts('read this https://example.com/x then tell me')).toEqual([
      { link: false, text: 'read this ' },
      { link: true, text: 'https://example.com/x', href: 'https://example.com/x' },
      { link: false, text: ' then tell me' },
    ]);
  });

  it('gives the sentence back its full stop', () => {
    const [, link, tail] = parts('it is at https://example.com/thing.');
    expect(link).toEqual({
      link: true,
      text: 'https://example.com/thing',
      href: 'https://example.com/thing',
    });
    expect(tail).toEqual({ link: false, text: '.' });
  });

  it('keeps a bracket that belongs to the address', () => {
    const [link] = parts('https://en.wikipedia.org/wiki/Dad_(disambiguation)');
    expect(link).toEqual({
      link: true,
      text: 'https://en.wikipedia.org/wiki/Dad_(disambiguation)',
      href: 'https://en.wikipedia.org/wiki/Dad_(disambiguation)',
    });
  });

  it('takes several', () => {
    expect(parts('https://a.example https://b.example').filter((p) => p.link)).toHaveLength(2);
  });

  /**
   * The whole reason this returns parts rather than a string: nothing here may
   * ever become markup, and no scheme but http(s) may ever become an href.
   */
  it('will not make a link out of anything else', () => {
    expect(parts('javascript:alert(1)')).toEqual([{ link: false, text: 'javascript:alert(1)' }]);
    expect(parts('www.example.com')).toEqual([{ link: false, text: 'www.example.com' }]);
    expect(parts('marc@example.com')).toEqual([{ link: false, text: 'marc@example.com' }]);
    expect(parts('<script>alert(1)</script>')).toEqual([
      { link: false, text: '<script>alert(1)</script>' },
    ]);
  });
});
