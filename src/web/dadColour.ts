/**
 * A dad's colour: one of six, from a hash of his member id.
 *
 * Stable for ever — the id never changes — and needing nothing stored. Two of
 * five men will sometimes share one; the glasses, the photo or the name
 * still tell them apart, and a colour that could be chosen is one more
 * setting nobody asked for.
 */
export const DAD_COLOURS = 6;

export function dadColour(memberId: string): number {
  let h = 0;
  for (let i = 0; i < memberId.length; i++) h = (h * 31 + memberId.charCodeAt(i)) >>> 0;
  return (h % DAD_COLOURS) + 1;
}

/** The CSS colour for a dad, from the palette in tokens.css. */
export function dadVar(memberId: string): string {
  return `var(--dad-${dadColour(memberId)})`;
}
