import { describe, expect, it } from 'vitest';
import { translator } from '../src/shared/dictionary';
import { ANNOUNCE_LENGTH, announce } from '../src/web/announce';

const en = translator('en');
const fr = translator('fr');

function media(contentType: string) {
  return { id: 'm1', name: 'IMG_1234.jpg', contentType, width: null, height: null, kept: false };
}

describe('a line arriving, said aloud', () => {
  it('is the name and the words', () => {
    expect(announce({ name: 'Sam', body: 'on my way' }, en)).toBe('Sam: on my way');
  });

  it('cuts a long line, with an ellipsis', () => {
    const said = announce({ name: 'Sam', body: 'a'.repeat(ANNOUNCE_LENGTH + 50) }, en);
    expect(said).toBe(`Sam: ${'a'.repeat(ANNOUNCE_LENGTH)}…`);
  });

  it('keeps a line exactly at the limit whole', () => {
    const body = 'b'.repeat(ANNOUNCE_LENGTH);
    expect(announce({ name: 'Sam', body }, en)).toBe(`Sam: ${body}`);
  });

  it('says what was sent with no words, never the file name', () => {
    expect(announce({ name: 'Sam', body: '', media: media('image/jpeg') }, en)).toBe(
      'Sam: a photo',
    );
    expect(announce({ name: 'Sam', body: '', media: media('audio/webm') }, en)).toBe(
      'Sam: a voice note',
    );
    expect(announce({ name: 'Sam', body: '', media: media('video/mp4') }, en)).toBe('Sam: a video');
    expect(announce({ name: 'Sam', body: '', media: media('application/pdf') }, en)).toBe(
      'Sam: a file',
    );
  });

  it('says both when there are words and a picture', () => {
    expect(announce({ name: 'Sam', body: 'the lake', media: media('image/png') }, en)).toBe(
      'Sam: the lake, a photo',
    );
  });

  it('speaks the reader’s language, and never translates what he typed', () => {
    expect(announce({ name: 'Sam', body: 'see you', media: media('image/png') }, fr)).toBe(
      'Sam: see you, une photo',
    );
  });
});
