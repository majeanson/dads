/**
 * What a page says about itself, read off its own tags.
 *
 * A link in the conversation gets a card: the page's title, a line of its
 * description, its picture and the name of the site — what iMessage, WhatsApp
 * and Slack all draw under a link, and what the men expect under a YouTube
 * address by now. The page declares all of it in `<meta>` tags (Open Graph,
 * then Twitter's names, then the plain `<title>`), which is what every one of
 * those apps reads too.
 *
 * Pure: it takes the HTML as a string and the address it came from and never
 * fetches anything, so the worker pool tests it against pages written by
 * hand. A regex over `<meta>` tags rather than a parser, because the tags
 * are in the head, the head is the first few kilobytes, and the attribute
 * grammar is small; a page too strange for this gets no card, which is the
 * right answer for a page that strange.
 */

export interface LinkPreview {
  title: string;
  description: string | null;
  /** The picture's own address, absolute, http(s) only. */
  image: string | null;
  /** The site's name as it gives it, else its host. */
  site: string;
}

/** Past these a card is a wall. A title is a line, a description two. */
export const TITLE_LENGTH = 120;
export const DESCRIPTION_LENGTH = 200;

/**
 * Every `<meta>` that names itself, by `property` or `name`, lowercased:
 * the first of each wins, as a crawler reads them. Plus the `<title>`.
 */
export function readTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = attributesOf(m[1] ?? '');
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase();
    const content = attrs.get('content');
    if (key === undefined || content === undefined || tags.has(key)) continue;
    const text = tidy(decode(content));
    if (text.length > 0) tags.set(key, text);
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (title?.[1] !== undefined) {
    const text = tidy(decode(title[1]));
    if (text.length > 0) tags.set('title', text);
  }
  return tags;
}

/**
 * The card, or nothing. A page with no title of any kind gets no card: a
 * card that says only "example.com" under a link that already says
 * "example.com" is the app repeating itself.
 */
export function previewOf(tags: Map<string, string>, pageUrl: string): LinkPreview | null {
  const title = first(tags, 'og:title', 'twitter:title', 'title');
  if (title === null) return null;
  const description = first(tags, 'og:description', 'twitter:description', 'description');
  const image = first(tags, 'og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image');
  const host = hostOf(pageUrl);
  return {
    title: cut(title, TITLE_LENGTH),
    description: description === null ? null : cut(description, DESCRIPTION_LENGTH),
    image: image === null ? null : absolute(image, pageUrl),
    site: first(tags, 'og:site_name') ?? host,
  };
}

/**
 * A YouTube address, which answers oEmbed: a small JSON with the title, the
 * channel and the thumbnail, cheaper and steadier than the watch page's
 * half-megabyte of HTML, and it says the same thing. Only the shapes that ARE
 * a video; the home page and a channel are left to their tags.
 */
export function youtubeVideo(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return /^\/[\w-]{6,}$/.test(url.pathname);
  if (host !== 'youtube.com') return false;
  if (url.pathname === '/watch') return url.searchParams.has('v');
  return /^\/(shorts|live|embed)\/[\w-]{6,}/.test(url.pathname);
}

/** What YouTube's oEmbed answers, made into the same card. */
export function previewFromOEmbed(
  data: {
    title?: unknown;
    author_name?: unknown;
    thumbnail_url?: unknown;
    provider_name?: unknown;
  },
  pageUrl: string,
): LinkPreview | null {
  if (typeof data.title !== 'string' || tidy(data.title).length === 0) return null;
  const image =
    typeof data.thumbnail_url === 'string' ? absolute(data.thumbnail_url, pageUrl) : null;
  return {
    title: cut(tidy(data.title), TITLE_LENGTH),
    description:
      typeof data.author_name === 'string' && tidy(data.author_name).length > 0
        ? cut(tidy(data.author_name), DESCRIPTION_LENGTH)
        : null,
    image,
    site: typeof data.provider_name === 'string' ? tidy(data.provider_name) : hostOf(pageUrl),
  };
}

/** The host a card names: no scheme, no "www.". */
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** An address a card may fetch: http(s), and nothing else. */
export function fetchable(href: string): URL | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function first(tags: Map<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = tags.get(key);
    if (value !== undefined) return value;
  }
  return null;
}

function absolute(src: string, base: string): string | null {
  try {
    const url = new URL(src, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function attributesOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/([^\s=/"'<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The few entities a title ever carries, and the numeric ones. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
