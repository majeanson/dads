import { DAD_COLOURS, HASHED_COLOURS } from '../shared/protocol';

export { DAD_COLOURS };

/**
 * A dad's colour: one of twelve.
 *
 * Unless he picked one, one of the first six, by the hash of his id — stable for ever, and
 * needing nothing stored. Two of five men will sometimes share one; the
 * glasses, the photo or the name still tell them apart, and a dad who minds
 * can choose.
 *
 * The choices live in the room's member list; `MembersProvider` hands them to
 * `chooseColours` whenever that list changes, so the many places that colour a
 * name (a line, a quote, a face) need not each ask for them.
 */
let chosen: ReadonlyMap<string, number> = new Map();

export function chooseColours(colours: ReadonlyMap<string, number>): void {
  chosen = colours;
}

/** The colour a dad would have with no choice made. */
export function hashedColour(memberId: string): number {
  let h = 0;
  for (let i = 0; i < memberId.length; i++) h = (h * 31 + memberId.charCodeAt(i)) >>> 0;
  return (h % HASHED_COLOURS) + 1;
}

export function dadColour(memberId: string): number {
  return chosen.get(memberId) ?? hashedColour(memberId);
}

/** The CSS colour for a dad, from the palette in tokens.css. */
export function dadVar(memberId: string): string {
  return `var(--dad-${dadColour(memberId)})`;
}
