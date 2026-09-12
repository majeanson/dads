/**
 * The word he searched for, marked inside the line that carries it.
 *
 * Split rather than replaced, exactly like `linkify`: this returns pieces and
 * the renderer builds the elements, so no string ever becomes markup. A dad
 * who searches for `<b>` gets `<b>` back.
 *
 * Pure and DOM-free so the worker pool can test it, which is the same reason
 * `linkify` and `messageGroups` live outside the components that render them.
 */
export interface Piece {
  text: string;
  hit: boolean;
}

/**
 * Case-insensitive and literal — no regex from a dad's typing, ever, and the
 * matching has to agree with the LIKE the server did, which is a plain
 * substring. An empty needle marks nothing rather than everything.
 */
export function highlight(body: string, needle: string): Piece[] {
  if (needle === '') return [{ text: body, hit: false }];

  const hay = body.toLowerCase();
  const find = needle.toLowerCase();
  const pieces: Piece[] = [];
  let at = 0;

  for (;;) {
    const found = hay.indexOf(find, at);
    if (found === -1) break;
    if (found > at) pieces.push({ text: body.slice(at, found), hit: false });
    pieces.push({ text: body.slice(found, found + find.length), hit: true });
    at = found + find.length;
  }

  if (at < body.length) pieces.push({ text: body.slice(at), hit: false });
  // A line that somehow holds no match is still a line to show.
  return pieces.length === 0 ? [{ text: body, hit: false }] : pieces;
}
