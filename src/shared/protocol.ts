import type { DadNight } from './dadNight';
import { parseTableEvent, type TableEvent } from './jaffre';
import type { Said } from './said';

/**
 * The wire between a dad's browser and his group's RoomDO. Shared by both so
 * the two can never disagree about a field name. Every frame is one JSON
 * object with a `t` tag; anything else is dropped.
 */

export const MAX_MESSAGE_LENGTH = 2000;

export type MessageKind = 'chat' | 'system' | 'prompt' | 'table';

export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  /** Known for images; lets the room hold the right shape before the bytes
   * arrive, so the conversation does not jump as it loads. */
  width: number | null;
  height: number | null;
}

export interface RoomMessage {
  /** Monotonic per room. What a reconnecting client sends back as `after`. */
  seq: number;
  /** Stable id shared with the D1 archive. */
  id: string;
  kind: MessageKind;
  memberId: string | null;
  name: string;
  body: string;
  createdAt: number;
  /** Set on kind 'prompt': which question this answers. */
  promptId?: string | null;
  /** A photo or file attached to the line. The bytes live behind
   * /api/media?id=…, never in the frame. */
  media?: Attachment | null;
  /**
   * Set on the lines the ROOM writes, never on a line a dad typed: what
   * happened, so each reader's own language can say it. `body` is the English
   * of the same thing, and is what a row from before this existed still has.
   */
  said?: Said | null;
}

/**
 * What a group has open. Three switches, on by default, and any dad may change
 * them — the group's setting rather than each man's, because two dads seeing
 * different menus is how a group stops sharing a room.
 */
export interface RoomsOpen {
  questions: boolean;
  week: boolean;
  table: boolean;
}

export interface RosterEntry {
  memberId: string;
  name: string;
}

/**
 * A dad on the call, and whether his microphone is off.
 *
 * The mute has to come from the room: from the other end of a peer connection
 * a muted track and a man who is simply not talking look exactly the same, and
 * "why is nobody answering me" is the whole reason to be able to tell.
 */
export interface CallMember extends RosterEntry {
  muted?: boolean;
}

export type ClientFrame =
  | { t: 'chat'; body: string; mediaId?: string }
  /** Sitting down at, getting up from, or muting yourself on the call. */
  | { t: 'call'; join: boolean; muted?: boolean }
  /** One leg of a WebRTC handshake, addressed to one other dad. The room
   * relays it without looking inside: what is in there is between the two
   * browsers. */
  | { t: 'rtc'; to: string; payload: unknown }
  | { t: 'prompt'; body: string }
  | { t: 'table'; event: TableEvent }
  | { t: 'typing' };

export type ServerFrame =
  | {
      t: 'hello';
      you: RosterEntry;
      roster: RosterEntry[];
      /** Who is already on the call when you arrive. */
      call: CallMember[];
      /** Messages after the client's `after`, oldest first. */
      messages: RoomMessage[];
    }
  | { t: 'roster'; roster: RosterEntry[] }
  /** Who is on the call right now. Separate from the roster: being in the room
   * and being on the call are different things. */
  | { t: 'call-roster'; members: CallMember[] }
  | { t: 'rtc'; from: string; name: string; payload: unknown }
  | { t: 'msg'; message: RoomMessage }
  | { t: 'typing'; memberId: string; name: string }
  | { t: 'night'; night: DadNight | null }
  | { t: 'rooms'; rooms: RoomsOpen }
  | { t: 'error'; code: 'bad_frame' | 'too_long' | 'empty' | 'no_prompt' | 'no_media' };

export function parseClientFrame(raw: unknown): ClientFrame | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const frame = value as { t?: unknown; body?: unknown };
  if (frame.t === 'typing') return { t: 'typing' };
  if (frame.t === 'chat' && typeof frame.body === 'string') {
    const mediaId = (value as { mediaId?: unknown }).mediaId;
    return typeof mediaId === 'string' && mediaId !== ''
      ? { t: 'chat', body: frame.body, mediaId }
      : { t: 'chat', body: frame.body };
  }
  if (frame.t === 'prompt' && typeof frame.body === 'string')
    return { t: 'prompt', body: frame.body };
  if (frame.t === 'call' && typeof (value as { join?: unknown }).join === 'boolean') {
    const { join, muted } = value as { join: boolean; muted?: unknown };
    return { t: 'call', join, muted: muted === true };
  }
  if (frame.t === 'rtc') {
    const { to, payload } = value as { to?: unknown; payload?: unknown };
    // The payload is opaque on purpose — the room is a wire, not a party to
    // the negotiation — but it must be addressed to somebody.
    return typeof to === 'string' && to !== '' && payload !== undefined
      ? { t: 'rtc', to, payload }
      : null;
  }
  if (frame.t === 'table') {
    // Validated by the jaffre module, which owns that vocabulary.
    const event = parseTableEvent((value as { event?: unknown }).event);
    return event ? { t: 'table', event } : null;
  }
  return null;
}
