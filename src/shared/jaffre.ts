import type { Said } from './said';

/**
 * The link between the two products.
 *
 * dads knows who you are and which group you are in; jaffre knows how to run a
 * card game. Neither needs to know anything else about the other, so the whole
 * connection is a URL going in and a small postMessage vocabulary coming back.
 */

/** Where jaffre lives. */
export const JAFFRE_ORIGIN = 'https://jaffre.marcportal.com';

/** Jaffre's own room-code rule (apps/server/src/index.ts JOIN_RE), and it
 * lowercases codes, so ours are lowercase from the start. */
const CODE_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * A group's table code: stable, readable, derived from the group so the dads
 * come back to the same table every week without anyone writing it down.
 * Stored on the group once minted (groups.jaffre_room_code) so it survives
 * even if this derivation later changes.
 */
export function deriveTableCode(groupSlug: string): string {
  const code = groupSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return CODE_PATTERN.test(code) ? code : 'the-dads';
}

export function isValidTableCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export interface TableLink {
  /** What the iframe loads. */
  embedUrl: string;
  /** Where "open it in its own tab" points. */
  shareUrl: string;
}

/**
 * Build the link into jaffre for this group's table.
 *
 * The hash route is jaffre's real route; its /join/<code> share link only
 * rewrites to it, and that rewrite drops the query string — so the embed goes
 * straight to the hash and keeps its parameters.
 *
 * `name` means a dad never types his name twice. `from=dads` tells jaffre
 * where the player came from so it can offer the way back.
 */
export function tableLink(code: string, name: string, origin = JAFFRE_ORIGIN): TableLink {
  const embed = new URLSearchParams({ name, from: 'dads' });
  return {
    embedUrl: `${origin}/?${embed}#room/${code}`,
    // The own-tab link carries `from` (so jaffre offers the way back) but NOT
    // the name: out there the dad is on his own jaffre, with his own account
    // and his own name, and dads has no business overwriting it.
    shareUrl: `${origin}/?from=dads#room/${code}`,
  };
}

// ---------------------------------------------------------------- bridge

/**
 * The postMessage vocabulary, versioned from the start. Both sides check the
 * other's origin; neither trusts the payload beyond these shapes.
 */
export const BRIDGE_VERSION = 1;

export type TableEvent =
  | { v: 1; t: 'ready' }
  | { v: 1; t: 'seated'; name: string }
  | { v: 1; t: 'left'; name: string }
  | { v: 1; t: 'game-started' }
  | { v: 1; t: 'game-over'; summary: string }
  // The quiet seats (2026-09-11). Still v: 1 — adding a kind breaks nobody,
  // because an unknown kind has always been dropped.
  /** A sitting player has let his turn go; the bot plays it in `seconds`. */
  | { v: 1; t: 'turn'; name: string; seconds: number }
  /** A seated dad dropped; a bot takes the seat in `seconds` (0: already has). */
  | { v: 1; t: 'away'; name: string; seconds: number }
  | { v: 1; t: 'back'; name: string }
  /** The frame's own socket to the game. */
  | { v: 1; t: 'connection'; state: 'reconnecting' | 'ok' };

const MAX_FIELD = 120;
/** Longer than any countdown the table runs; anything above is a bug or a lie. */
const MAX_SECONDS = 3600;

function seconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.round(value), MAX_SECONDS);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FIELD);
}

/** Anything that is not exactly one of these shapes is dropped. */
export function parseTableEvent(data: unknown): TableEvent | null {
  if (!data || typeof data !== 'object') return null;
  const frame = data as {
    v?: unknown;
    t?: unknown;
    name?: unknown;
    summary?: unknown;
    seconds?: unknown;
    state?: unknown;
  };
  if (frame.v !== BRIDGE_VERSION) return null;

  switch (frame.t) {
    case 'ready':
    case 'game-started':
      return { v: 1, t: frame.t };
    case 'seated':
    case 'left':
    case 'back': {
      const name = text(frame.name);
      return name ? { v: 1, t: frame.t, name } : null;
    }
    case 'game-over': {
      const summary = text(frame.summary);
      return summary ? { v: 1, t: 'game-over', summary } : null;
    }
    case 'turn':
    case 'away': {
      const name = text(frame.name);
      const s = seconds(frame.seconds);
      return name && s !== null ? { v: 1, t: frame.t, name, seconds: s } : null;
    }
    case 'connection':
      return frame.state === 'reconnecting' || frame.state === 'ok'
        ? { v: 1, t: 'connection', state: frame.state }
        : null;
    default:
      return null;
  }
}

/**
 * What a table event IS, for the room to say in whatever language is reading.
 * Null for the plumbing: 'ready' is the frame proving it is alive, and nobody
 * needs to be told that. Null too for the quiet seats — a man's turn sitting
 * for twenty seconds is said beside the frame and to him, never to the room,
 * where a line of it every hand would be furniture.
 */
export function tableSaid(event: TableEvent): Said | null {
  switch (event.t) {
    case 'seated':
      return { k: 'table_seated', name: event.name };
    case 'left':
      return { k: 'table_left', name: event.name };
    case 'game-started':
      return { k: 'table_started' };
    case 'game-over':
      return { k: 'table_over', summary: event.summary };
    case 'ready':
    case 'turn':
    case 'away':
    case 'back':
    case 'connection':
      return null;
  }
}
