/**
 * A link in a message is a link.
 *
 * Split rather than replaced: the text is rendered as text and the links as
 * anchors, so nothing here ever produces markup from a string. A dad who types
 * `<script>` gets `<script>`, the same as he always did.
 *
 * Lives in shared rather than web because it is pure and is tested in the
 * worker pool, which has no DOM.
 *
 * Deliberately narrow — http and https only, no bare "www.", no email, no
 * guessing at what somebody meant. A false positive turns a man's sentence
 * into a link he did not write, which is worse than making him paste a full
 * address.
 */
export type Part = { link: false; text: string } | { link: true; text: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/** Trailing punctuation belongs to the sentence, not to the address. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function parts(body: string): Part[] {
  const found: Part[] = [];
  let at = 0;

  for (const match of body.matchAll(URL_PATTERN)) {
    const start = match.index;
    let raw = match[0];

    // "…see https://example.com/x." — the full stop is the sentence's.
    const trimmed = raw.replace(TRAILING, '');
    // Unless the bracket it ends with was opened inside the address itself,
    // as wikipedia and every issue tracker delight in doing.
    const balanced = raw.endsWith(')') && countOf(raw, '(') > countOf(raw, ')') - 1;
    if (!balanced) raw = trimmed;

    let href: string;
    try {
      href = new URL(raw).toString();
    } catch {
      continue;
    }

    if (start > at) found.push({ link: false, text: body.slice(at, start) });
    // What it SAYS has to be where it goes. "https://example.com@evil.test/x"
    // reads as example.com and lands on evil.test; a Cyrillic а in a hostname
    // reads as Latin and resolves to punycode. Where the address the browser
    // will actually use differs from the characters a dad typed, the honest
    // one is shown — even though it is uglier, because the ugly one is true.
    found.push({ link: true, text: href === raw ? raw : href, href });
    at = start + raw.length;
  }

  if (at < body.length) found.push({ link: false, text: body.slice(at) });
  return found.length > 0 ? found : [{ link: false, text: body }];
}

/** Past this a link is a wall; the host is what a man reads anyway. */
const SHOWN = 40;

/**
 * What a link SHOWS. The scheme goes, "www." goes, a lone trailing slash
 * goes, and a long path is cut so the line stays a line. The host is never
 * cut — it is the one part that says where he is being sent, and the full
 * address is on the anchor's title for anyone who wants it.
 */
export function shortLink(href: string): string {
  const shown = href
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
  if (shown.length <= SHOWN) return shown;
  const slash = shown.indexOf('/');
  const host = slash === -1 ? shown : shown.slice(0, slash);
  if (host.length >= SHOWN - 1) return `${host}…`;
  return `${shown.slice(0, SHOWN - 1)}…`;
}

function countOf(text: string, character: string): number {
  let n = 0;
  for (const c of text) if (c === character) n += 1;
  return n;
}
