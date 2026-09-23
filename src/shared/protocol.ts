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
  /**
   * Off the shelf, and the pruner will not take it.
   *
   * On the attachment rather than fetched, because it is hydrated from D1
   * beside the rest of the row on every backfill — and it changes live for
   * everyone through the `kept` frame, so two dads never sit looking at the
   * same picture disagreeing about whether it is safe.
   */
  kept: boolean;
}

/**
 * The five marks, and there is no picker.
 *
 * A fixed short set rather than every emoji a keyboard has: what these are
 * for is saying "heard you" on a night you have nothing to add, and a grid of
 * two thousand faces is a worse answer to that than five. Chosen for what
 * five men actually say to each other — yes, warmth, that's funny, hang in
 * there, thank you.
 */
/**
 * Every mark there is: the composer's thirty-two, which start with the ones
 * a man reaches for most. Still an allowlist — a mark ends up on everyone's
 * screen and there is no reason for it to be free text — only a longer one
 * (2026-09-23): the row under a line shows six, and "+" opens the rest.
 */
export const MARKS = [
  '👍',
  '❤️',
  '😂',
  '💪',
  '🙏',
  '😊',
  '😅',
  '😉',
  '😍',
  '😎',
  '🤣',
  '😭',
  '😤',
  '🙄',
  '😴',
  '🤔',
  '👀',
  '🔥',
  '🎉',
  '👌',
  '✌️',
  '🤝',
  '👏',
  '🍺',
  '☕',
  '🍕',
  '🏒',
  '⚽',
  '🎮',
  '🃏',
  '⏰',
  '👶',
] as const;

/** The six a phone shows before it has learnt anything about its dad. */
export const REACTIONS = ['👍', '❤️', '😂', '💪', '🙏', '😎'] as const;

export function isReaction(emoji: string): boolean {
  return (MARKS as readonly string[]).includes(emoji);
}

/** One mark on one line, and who put it there. */
export interface Reaction {
  emoji: string;
  /** Member ids. The client works out which one is its own. */
  by: string[];
}

/**
 * What a line was answering, as it was at the time.
 *
 * A snapshot and not a reference: the original may scroll out of the
 * backfill, be taken back or be edited afterwards, and the quote should still
 * say what he was answering. Bounded, because it rides every frame the line
 * is in.
 */
export interface ReplyTo {
  id: string;
  name: string;
  body: string;
}

export const REPLY_QUOTE_LENGTH = 140;

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
  /** Marks on this line, hydrated from D1 on backfill like the attachment.
   * Absent means none, which is nearly every line. */
  reactions?: Reaction[];
  /** The line this one answers, if it answers one. */
  reply?: ReplyTo | null;
  /** When the man who typed it last changed the words. Null or absent: never. */
  editedAt?: number | null;
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

/**
 * The pairs a dad can wear. An allowlist, like the marks: it is drawn on
 * everyone's screen, and there is no reason for it to be anything else.
 * `shades` is the app's own, and what a dad who never chose wears.
 */
export const GLASSES = ['shades', 'aviators', 'round', 'square', '3d', 'goggles'] as const;
export type GlassesKind = (typeof GLASSES)[number];

export function isGlasses(value: unknown): value is GlassesKind {
  return typeof value === 'string' && (GLASSES as readonly string[]).includes(value);
}

export interface RosterEntry {
  memberId: string;
  name: string;
  /** The pair he wears, when he has chosen one. Absent is the app's shades. */
  glasses?: GlassesKind;
  /**
   * When this dad last set his face, or absent if he has none.
   *
   * A version rather than a URL: the client builds `/api/face?member=…&v=…`
   * from it, which is what lets the picture be cached for a year and still
   * change the moment he sets a new one.
   */
  face?: number;
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
  /**
   * `cid` is the browser's own id for this line, and it is what makes a bad
   * signal survivable: the sender holds the line until it comes back with the
   * same cid, and re-sends on reconnect if it never did. The room uses it to
   * ignore a second copy of one it already posted.
   */
  | { t: 'chat'; body: string; mediaId?: string; cid?: string; replyTo?: string }
  /** Sitting down at, getting up from, or muting yourself on the call. */
  | { t: 'call'; join: boolean; muted?: boolean }
  /** One leg of a WebRTC handshake, addressed to one other dad. The room
   * relays it without looking inside: what is in there is between the two
   * browsers. */
  | { t: 'rtc'; to: string; payload: unknown }
  | { t: 'prompt'; body: string }
  | { t: 'table'; event: TableEvent }
  /**
   * Take back something you said. Only your own, only what you typed, and it
   * goes from the archive, the room's own tail and every open phone — along
   * with any photo on it. There is no time limit: the case this exists for is
   * a picture of somebody's child in the wrong room, and a man might notice
   * that a week later.
   */
  | { t: 'retract'; id: string }
  /** Put a mark on a line, or take yours off. `on` says which. */
  | { t: 'react'; id: string; emoji: string; on: boolean }
  /** Change the words of a line you typed. Same authority as taking it back. */
  | { t: 'edit'; id: string; body: string }
  | { t: 'typing' };

export type ServerFrame =
  | {
      t: 'hello';
      you: RosterEntry;
      roster: RosterEntry[];
      /** Who is already on the call when you arrive. */
      call: CallMember[];
      /**
       * Everyone in the group, present or not, with the version of each
       * one's face.
       *
       * Separate from `roster`, which is who is CONNECTED: a line said on
       * Tuesday by a man who is not here tonight still has his face beside
       * it. One source of truth for faces, so a message never carries a
       * version that has since gone stale.
       */
      members: RosterEntry[];
      /** Messages after the client's `after`, oldest first. */
      messages: RoomMessage[];
      /**
       * Lines taken back while this socket was away, for a client resuming
       * from its last seq rather than reloading — it still holds them, and
       * everyone else has lost them. Empty on a fresh load.
       */
      gone: string[];
    }
  | { t: 'roster'; roster: RosterEntry[] }
  /** One dad's name or face changed. Distinct from `roster`, which is about
   * who is connected: this is about who he is, present or not. */
  | { t: 'member'; member: RosterEntry }
  /** Who is on the call right now. Separate from the roster: being in the room
   * and being on the call are different things. */
  | { t: 'call-roster'; members: CallMember[] }
  | { t: 'rtc'; from: string; name: string; payload: unknown }
  /** `cid` is echoed back to everyone, and means something only to the browser
   * that chose it: its line arrived and can stop being held. */
  | { t: 'msg'; message: RoomMessage; cid?: string }
  /** A line somebody took back. Drop it: it is gone from the archive too. */
  | { t: 'gone'; id: string }
  /** Every mark on one line, after a change. Whole list, not a delta: five
   * dads tapping at once is not worth a merge rule on the client. */
  | { t: 'reacted'; id: string; reactions: Reaction[] }
  /** A line whose words changed. Everyone is told, the editor included. */
  | { t: 'edited'; id: string; body: string; editedAt: number }
  | { t: 'typing'; memberId: string; name: string }
  /**
   * A picture taken off the shelf, or put back on it.
   *
   * Broadcast rather than left to the phone that asked, because whether a
   * photograph survives the next upload is a fact about the room and not
   * about one dad's screen. Addressed by media id: the same picture can only
   * be on one line, but the line's id is not what the pruner knows it by.
   */
  | { t: 'kept'; mediaId: string; on: boolean }
  | { t: 'night'; night: DadNight | null }
  /**
   * Something changed that a screen reads over HTTP: who is coming and what
   * is up for the night ('night'), or what is waiting for HIM ('todo').
   *
   * A nudge and not the data, exactly like the `poll` frame beside it —
   * whoever is looking answers by fetching, and everyone else pays nothing.
   *
   * It exists because those screens used to re-read when a LINE went past
   * saying somebody had RSVP'd or filled in his week. Those lines were doing
   * two jobs: telling the room, and telling the screens to look again. The
   * room's half is gone — the conversation is what the dads typed — and this
   * is the half that had to stay, or home would sit there showing who was
   * coming an hour ago.
   */
  | { t: 'stir'; what: 'night' | 'todo' | 'table' }
  /**
   * Somebody marked the calendar that picks the next night.
   *
   * A nudge and not the marks themselves: the calendar is read over HTTP, and
   * a frame that carried five dads' answers for a fortnight would be the
   * whole poll fanned out on every tap. The client answers it by re-reading.
   * Nothing is said in the conversation — sixty lines about one decision is
   * how a conversation becomes a calendar.
   */
  | { t: 'poll' }
  | { t: 'rooms'; rooms: RoomsOpen }
  /**
   * The room changed hands.
   *
   * Pushed for the same reason the switches are: the man it was handed TO has
   * to find out without reloading, or he is looking at a room he now owns and
   * being told the switches are somebody else's. Null is a room with no
   * creator, which is what every room made before creators existed has.
   */
  | { t: 'owner'; createdBy: string | null }
  /**
   * A frame the room would not take.
   *
   * `cid` is the sender's own id for the line, echoed back when the refused
   * frame carried one — and it is what makes this safe to act on. The outbox
   * drops the line an error is ABOUT, and without a name on it the client had
   * to guess the oldest one in flight: so a refused edit, or a prompt answer
   * the room had no question for, quietly threw away a chat line that was
   * still perfectly good and would have gone through on the next try.
   */
  | {
      t: 'error';
      code: 'bad_frame' | 'too_long' | 'empty' | 'no_prompt' | 'no_media';
      cid?: string;
    };

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
    const { mediaId, cid, replyTo } = value as {
      mediaId?: unknown;
      cid?: unknown;
      replyTo?: unknown;
    };
    const chat: ClientFrame = { t: 'chat', body: frame.body };
    if (typeof mediaId === 'string' && mediaId !== '') chat.mediaId = mediaId;
    // Opaque, and bounded so it cannot become a channel of its own.
    if (typeof cid === 'string' && cid !== '' && cid.length <= 64) chat.cid = cid;
    // An id, resolved by the room: the client never supplies the quote.
    if (typeof replyTo === 'string' && replyTo !== '' && replyTo.length <= 64)
      chat.replyTo = replyTo;
    return chat;
  }
  if (frame.t === 'edit' && typeof frame.body === 'string') {
    const { id } = value as { id?: unknown };
    return typeof id === 'string' && id !== '' && id.length <= 64
      ? { t: 'edit', id, body: frame.body }
      : null;
  }
  if (frame.t === 'prompt' && typeof frame.body === 'string')
    return { t: 'prompt', body: frame.body };
  if (frame.t === 'retract') {
    const { id } = value as { id?: unknown };
    // Bounded like a cid: an id is ours, and nothing this long is one.
    return typeof id === 'string' && id !== '' && id.length <= 64 ? { t: 'retract', id } : null;
  }
  if (frame.t === 'react') {
    const { id, emoji, on } = value as { id?: unknown; emoji?: unknown; on?: unknown };
    // The mark is an allowlist and not free text: this ends up in a column
    // and on everyone's screen, and there is no reason for it to be anything
    // but one of the known marks.
    if (typeof id !== 'string' || id === '' || id.length > 64) return null;
    if (typeof emoji !== 'string' || !isReaction(emoji)) return null;
    return { t: 'react', id, emoji, on: on === true };
  }
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

/**
 * A line found again by searching the archive.
 *
 * Not a `Message`: it has no `seq`, because seq is the room object's
 * autoincrement and this row came out of D1, which may be older than
 * anything the object still holds. It carries no marks either — a search
 * result is a line quoted back at you, not a line you are standing in.
 */
export interface Found {
  id: string;
  memberId: string | null;
  /** Empty for a dad whose member row is gone. The line is still the group's. */
  name: string;
  kind: MessageKind;
  body: string;
  at: number;
  media: Attachment | null;
}

/**
 * Shorter than this and every query matches half the archive, which is not an
 * answer to anything. Shared so the field and the route agree about when a
 * search is worth making.
 */
export const MIN_SEARCH = 2;
