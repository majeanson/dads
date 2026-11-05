/**
 * A line that recommends something, found by the address in it.
 *
 * The list of picks is a view of what was already said, so the only thing it
 * needs to know about a line is: does it carry a link from a site that is
 * about something to watch, to listen to or to read. Pure, over `linkify`'s
 * own idea of a link, so a line and its list always agree about what an
 * address is.
 *
 * Hosts are matched as hosts. "notyoutube.com" and "example.com/?u=youtube.com"
 * are not YouTube; the whole address is never searched for a name.
 */
import { parts } from './linkify';
import { youtubeVideo } from './unfurl';

export const PICK_CATEGORIES = ['watch', 'listen', 'read'] as const;
export type PickCategory = (typeof PICK_CATEGORIES)[number];

export interface Pick {
  url: string;
  category: PickCategory;
}

/**
 * What the SQL narrows by before this decides: a host fragment per site, per
 * category. Deliberately loose (a LIKE over the body); `categoryOf` is the
 * test, this only keeps the scan from reading every line.
 */
export const PICK_FRAGMENTS: Record<PickCategory, string[]> = {
  watch: ['youtube.com', 'youtu.be', 'imdb.com', 'letterboxd.com', 'boxd.it'],
  listen: ['spotify.com', 'music.apple.com', 'podcasts.apple.com'],
  read: ['goodreads.com', 'openlibrary.org', 'amazon.', 'books.apple.com'],
};

/** Hosts without the prefixes a phone adds. */
function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www|m)\./, '');
}

/**
 * Amazon sells everything. A book is the one thing whose product number is an
 * ISBN-10 (nine digits and a digit or X), so only `/dp/<isbn10>` and
 * `/gp/product/<isbn10>` count. A Kindle edition has an ASIN starting "B0" and
 * is NOT recognised: the address alone cannot say it is a book. A short
 * amzn.to link is not followed, so it is not recognised either.
 */
const AMAZON_HOST = /^amazon\.(com|ca|com\.au|co\.uk|fr|de|es|it|nl|co\.jp|in)$/;
const AMAZON_BOOK = /\/(?:dp|gp\/product)\/\d{9}[\dX](?:[/?#]|$)/i;

export function categoryOf(href: string): PickCategory | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = hostOf(url);
  const path = url.pathname;

  if (youtubeVideo(href)) return 'watch';
  if (host === 'imdb.com') return /^\/title\/tt\d+/.test(path) ? 'watch' : null;
  if (host === 'letterboxd.com') return /^\/film\/[^/]+/.test(path) ? 'watch' : null;
  if (host === 'boxd.it') return /^\/\w+/.test(path) ? 'watch' : null;

  if (host === 'open.spotify.com') {
    // A locale prefix ("/intl-fr/") is how Spotify spells some addresses.
    return /^\/(?:intl-[\w-]+\/)?(track|album|playlist|artist|episode|show)\/\w+/.test(path)
      ? 'listen'
      : null;
  }
  if (host === 'music.apple.com' || host === 'podcasts.apple.com') {
    return path.length > 1 ? 'listen' : null;
  }

  if (host === 'goodreads.com') return /^\/(book|work)\/show\//.test(path) ? 'read' : null;
  if (host === 'openlibrary.org') return /^\/(works|books)\/\w+/.test(path) ? 'read' : null;
  if (host === 'books.apple.com') return path.length > 1 ? 'read' : null;
  if (AMAZON_HOST.test(host)) return AMAZON_BOOK.test(path) ? 'read' : null;

  return null;
}

/** The first link in a line that is one of ours, or null. */
export function pickOf(body: string): Pick | null {
  for (const part of parts(body)) {
    if (!part.link) continue;
    const category = categoryOf(part.href);
    if (category !== null) return { url: part.href, category };
  }
  return null;
}

/** What `GET /api/picks` hands the sheet, one per line, newest first. */
export interface PickItem {
  /** The line's id. The archive has no `seq`; that is the room object's. */
  id: string;
  memberId: string | null;
  /** Empty if the member row is gone. The line is still the group's. */
  name: string;
  /** He has left the room. His line stays, as it does in the conversation. */
  gone: boolean;
  createdAt: number;
  url: string;
  category: PickCategory;
  marks: { emoji: string; by: string[] }[];
}

/** `?only=` narrows to a category; anything else is everybody's. */
export function onlyCategory(only: string | null): PickCategory | null {
  return (PICK_CATEGORIES as readonly string[]).includes(only ?? '')
    ? (only as PickCategory)
    : null;
}
