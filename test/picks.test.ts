import { describe, expect, it } from 'vitest';
import { categoryOf, pickOf } from '../src/shared/picks';

describe('categoryOf', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'watch'],
    ['https://youtu.be/dQw4w9WgXcQ', 'watch'],
    ['https://m.youtube.com/shorts/abcdef123', 'watch'],
    ['https://www.imdb.com/title/tt0111161/', 'watch'],
    ['https://letterboxd.com/film/heat-1995/', 'watch'],
    ['https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'listen'],
    ['https://open.spotify.com/intl-fr/album/abc123', 'listen'],
    ['https://music.apple.com/ca/album/x/123', 'listen'],
    ['https://podcasts.apple.com/ca/podcast/x/id123', 'listen'],
    ['https://www.goodreads.com/book/show/5107.The_Catcher', 'read'],
    ['https://openlibrary.org/works/OL45804W/Fantastic', 'read'],
    ['https://books.apple.com/ca/book/x/id123', 'read'],
    ['https://www.amazon.ca/Some-Title/dp/0743273567/ref=x', 'read'],
    ['https://www.amazon.com/gp/product/043942089X', 'read'],
  ])('%s is %s', (href, category) => {
    expect(categoryOf(href)).toBe(category);
  });

  it.each([
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://example.com/?u=youtube.com/watch?v=dQw4w9WgXcQ',
    'https://example.com/youtu.be/abcdefgh',
    'https://www.youtube.com/@somechannel',
    'https://www.imdb.com/',
    'https://open.spotify.com/',
    'https://notspotify.com/track/abc',
    'https://www.amazon.ca/dp/B08N5WRWNW',
    'https://www.amazon.ca/gp/cart/view.html',
    'https://amazon.evil.test/dp/0743273567',
    'ftp://youtu.be/dQw4w9WgXcQ',
    'not a url',
  ])('%s is nothing', (href) => {
    expect(categoryOf(href)).toBeNull();
  });
});

describe('pickOf', () => {
  it('finds the first recognised link, skipping others', () => {
    expect(pickOf('see https://example.com/a and https://youtu.be/dQw4w9WgXcQ.')).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      category: 'watch',
    });
  });
  it('takes the first of two', () => {
    expect(
      pickOf('https://open.spotify.com/track/abc https://youtu.be/dQw4w9WgXcQ')?.category,
    ).toBe('listen');
  });
  it('is null for words and for a plain link', () => {
    expect(pickOf('youtube.com is great')).toBeNull();
    expect(pickOf('https://example.com/?u=youtube.com')).toBeNull();
  });
});
