import { describe, expect, it } from 'vitest';
import {
  matching,
  mentionAt,
  mentioned,
  mentionsIn,
  splitMentions,
  tagged,
} from '../src/shared/mentions';

const DADS = [
  { id: 'm', name: 'Marc' },
  { id: 's', name: 'Sam' },
  { id: 'j', name: 'Marc Jr' },
  { id: 'e', name: 'Étienne' },
];

describe('a name after an @', () => {
  it('finds a dad in the middle of a sentence', () => {
    expect(splitMentions('hey @Sam you coming', DADS)).toEqual([
      { mention: false, text: 'hey ' },
      { mention: true, text: '@Sam', id: 's' },
      { mention: false, text: ' you coming' },
    ]);
  });

  it('leaves a plain sentence alone', () => {
    expect(splitMentions('no names here', DADS)).toEqual([
      { mention: false, text: 'no names here' },
    ]);
  });

  it('is not fussy about case, and keeps what he typed', () => {
    expect(splitMentions('@sam?', DADS)).toEqual([
      { mention: true, text: '@sam', id: 's' },
      { mention: false, text: '?' },
    ]);
  });

  it('takes the longest name, so Marc Jr is not Marc', () => {
    expect(mentioned('@Marc Jr and @Marc', DADS)).toEqual(['j', 'm']);
  });

  it('does not stop at half a name', () => {
    expect(mentionsIn('@Samuel', DADS)).toEqual([]);
    expect(mentionsIn('@Marcus', DADS)).toEqual([]);
  });

  it('is not an email address or a handle', () => {
    expect(mentionsIn('write to sam@sam.test', DADS)).toEqual([]);
    expect(mentionsIn('x@Sam', DADS)).toEqual([]);
  });

  it('reads accents', () => {
    expect(mentioned('@étienne t’es là?', DADS)).toEqual(['e']);
  });

  it('names each dad once', () => {
    expect(mentioned('@Sam @Sam @Marc', DADS)).toEqual(['s', 'm']);
  });

  it('ignores a dad with no name', () => {
    expect(mentionsIn('@ hello', [{ id: 'x', name: '' }])).toEqual([]);
  });
});

describe('typing one', () => {
  it('knows the @ the caret is in, and what has been typed of the name', () => {
    expect(mentionAt('hey @Sa', 7)).toEqual({ start: 4, query: 'Sa' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('is nothing before the caret has been placed', () => {
    // A draft restored from storage, the caret still at nought: not typing.
    expect(mentionAt('@Sam are you in?', 0)).toBeNull();
  });

  it('is nothing with no @, or an @ inside a word', () => {
    expect(mentionAt('hey Sam', 7)).toBeNull();
    expect(mentionAt('sam@sam', 7)).toBeNull();
  });

  it('gives up on a query the length of a sentence', () => {
    expect(mentionAt('@' + 'a'.repeat(41), 42)).toBeNull();
  });

  it('matches the start of a name or of a word in it', () => {
    expect(matching('ma', DADS).map((p) => p.id)).toEqual(['m', 'j']);
    expect(matching('jr', DADS).map((p) => p.id)).toEqual(['j']);
    expect(matching('', DADS)).toEqual(DADS);
    expect(matching('zz', DADS)).toEqual([]);
  });

  it('offers nobody once the whole name and a space are in', () => {
    expect(matching('Marc Jr ', DADS)).toEqual([]);
    // Without the space he may still be typing "Marc Jr…", so Marc Jr stays.
    expect(matching('Marc Jr', DADS).map((p) => p.id)).toEqual(['j']);
    expect(matching('Marc ', DADS).map((p) => p.id)).toEqual([]);
  });

  it('puts the name in, and a space, and the caret after', () => {
    expect(tagged('hey @Sa there', 4, 7, 'Sam')).toEqual({
      next: 'hey @Sam  there',
      caret: 9,
    });
  });
});
