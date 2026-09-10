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
    found.push({ link: true, text: raw, href });
    at = start + raw.length;
  }

  if (at < body.length) found.push({ link: false, text: body.slice(at) });
  return found.length > 0 ? found : [{ link: false, text: body }];
}

function countOf(text: string, character: string): number {
  let n = 0;
  for (const c of text) if (c === character) n += 1;
  return n;
}
