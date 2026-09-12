/**
 * A dad's initials, for when he has not set a face.
 *
 * Never an empty circle: the whole job is telling five men apart, and a blank
 * is worse at that than two letters.
 *
 * Split on WHITESPACE rather than taking the first two characters, so
 * "Marc-antoine" is M and not MA — a hyphen is one name and a space is two.
 * First and LAST word, not first and second, because "Jean Paul Tremblay"
 * is JT to everyone who knows him. Code points, not char codes: a name can
 * begin outside the basic plane and half a surrogate pair is a broken glyph.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0] ?? '';
  if (words.length === 1) return first;
  const last = [...words[words.length - 1]!][0] ?? '';
  return first + last;
}
