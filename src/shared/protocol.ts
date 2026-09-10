import type { DadNight } from './dadNight';

/**
 * The wire between a dad's browser and his group's RoomDO. Shared by both so
 * the two can never disagree about a field name. Every frame is one JSON
 * object with a `t` tag; anything else is dropped.
 */

export const MAX_MESSAGE_LENGTH = 2000;

export type MessageKind = 'chat' | 'system' | 'prompt' | 'table';

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
}

export interface RosterEntry {
  memberId: string;
  name: string;
}

export type ClientFrame =
  { t: 'chat'; body: string } | { t: 'prompt'; body: string } | { t: 'typing' };

export type ServerFrame =
  | {
      t: 'hello';
      you: RosterEntry;
      roster: RosterEntry[];
      /** Messages after the client's `after`, oldest first. */
      messages: RoomMessage[];
    }
  | { t: 'roster'; roster: RosterEntry[] }
  | { t: 'msg'; message: RoomMessage }
  | { t: 'typing'; memberId: string; name: string }
  | { t: 'night'; night: DadNight | null }
  | { t: 'error'; code: 'bad_frame' | 'too_long' | 'empty' | 'no_prompt' };

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
  if (frame.t === 'chat' && typeof frame.body === 'string') return { t: 'chat', body: frame.body };
  if (frame.t === 'prompt' && typeof frame.body === 'string')
    return { t: 'prompt', body: frame.body };
  return null;
}
