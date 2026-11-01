/**
 * "@Sam" in a line is Sam.
 *
 * Nothing is stored and nothing rides the wire: a mention is a dad's name
 * after an "@", found again by whoever reads the line against the names the
 * room knows. Split rather than replaced, like a link (`linkify.ts`): the
 * text stays text, and a name is a name wherever it appears, so a man who
 * changes his name is not found under the old one — which is right, since
 * the line still says what he typed.
 *
 * Pure, so the worker pool tests it and the room's object can use it to tell
 * the man named that he was.
 */

export interface Named {
  id: string;
  name: string;
}

export type MentionPart =
  { mention: false; text: string } | { mention: true; text: string; id: string };

/** A letter or a digit, in any script: the thing a name is made of. */
const WORDY = /[\p{L}\p{N}]/u;

/** An "@" glued to a word before it (an email, a handle) is not a mention. */
function startsAWord(text: string, at: number): boolean {
  return at === 0 || !WORDY.test(text[at - 1]!);
}

/** The name has to end where the word ends: "@Sam" is not "@Samuel". */
function endsAWord(text: string, at: number): boolean {
  return at >= text.length || !WORDY.test(text[at]!);
}

/** Longest name first, so "@Marc Jr" is Marc Jr and not Marc with a Jr. */
function byLength(people: Named[]): Named[] {
  return people.filter((p) => p.name.trim() !== '').sort((a, b) => b.name.length - a.name.length);
}

/** Where every mention in `body` is, and whose it is. */
export function mentionsIn(
  body: string,
  people: Named[],
): { start: number; end: number; id: string }[] {
  const sorted = byLength(people);
  const found: { start: number; end: number; id: string }[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '@' || !startsAWord(body, i)) continue;
    for (const p of sorted) {
      const end = i + 1 + p.name.length;
      if (end > body.length) continue;
      if (body.slice(i + 1, end).toLowerCase() !== p.name.toLowerCase()) continue;
      if (!endsAWord(body, end)) continue;
      found.push({ start: i, end, id: p.id });
      i = end - 1;
      break;
    }
  }
  return found;
}

/** The text as parts, the mentions marked. For rendering. */
export function splitMentions(text: string, people: Named[]): MentionPart[] {
  const parts: MentionPart[] = [];
  let at = 0;
  for (const m of mentionsIn(text, people)) {
    if (m.start > at) parts.push({ mention: false, text: text.slice(at, m.start) });
    parts.push({ mention: true, text: text.slice(m.start, m.end), id: m.id });
    at = m.end;
  }
  if (at < text.length) parts.push({ mention: false, text: text.slice(at) });
  return parts.length > 0 ? parts : [{ mention: false, text }];
}

/** Who a line names, each once, in the order named. */
export function mentioned(body: string, people: Named[]): string[] {
  return [...new Set(mentionsIn(body, people).map((m) => m.id))];
}

/**
 * The "@…" the caret is in while he types, if any: where it starts and what
 * he has typed of the name so far. A name may hold a space, so the query
 * may too; the caller closes the picker when nobody matches it.
 */
export function mentionAt(draft: string, caret: number): { start: number; query: string } | null {
  const at = draft.lastIndexOf('@', caret - 1);
  if (at === -1 || !startsAWord(draft, at)) return null;
  const query = draft.slice(at + 1, caret);
  // A name is not forty characters, and a query that long is a sentence
  // with an "@" somewhere behind it.
  if (query.length > 40 || query.includes('\n')) return null;
  return { start: at, query };
}

/** The dads whose name, or a word of it, starts with what he has typed. */
export function matching(query: string, people: Named[]): Named[] {
  const q = query.trim().toLowerCase();
  if (q === '') return people;
  // "@Tag Sam " — the whole name and a space after it — is a tag already
  // made, not the start of one: offering Sam again kept the list open.
  if (query !== query.trimEnd() && people.some((p) => p.name.toLowerCase() === q)) return [];
  return people.filter((p) => {
    const name = p.name.toLowerCase();
    return name.startsWith(q) || name.split(/\s+/).some((word) => word.startsWith(q));
  });
}

/** The draft with the "@…" he was typing replaced by the name, and a space. */
export function tagged(
  draft: string,
  start: number,
  caret: number,
  name: string,
): { next: string; caret: number } {
  const tag = `@${name} `;
  return { next: draft.slice(0, start) + tag + draft.slice(caret), caret: start + tag.length };
}
