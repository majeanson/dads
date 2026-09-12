import type { T } from './dictionary';
import type { TableEvent } from './jaffre';

/**
 * What the table is doing right now, for the panel's own head.
 *
 * A turn sitting, a dad dropped, a bot playing for him, the frame's socket
 * down. Said beside the frame and nowhere else: the room never hears it,
 * because a line of it every hand would be furniture.
 *
 * Out of the component and into shared on purpose — it is a state machine
 * over the bridge vocabulary and nothing about it needs a browser, so it is
 * tested in the worker pool alongside `said.ts` and `linkify.ts`.
 */
export type Note =
  | { kind: 'turn'; name: string; until: number }
  | { kind: 'away'; name: string; until: number }
  | { kind: 'bot'; name: string }
  | { kind: 'reconnecting' };

/**
 * The next note, given what the table just said.
 *
 * A countdown carries the instant it ends and clears itself; the others are
 * cleared by the event that undoes them. A `connection` blip deliberately
 * does NOT destroy a countdown that is running — the socket coming and going
 * says nothing about whose turn it is, and losing the countdown to a
 * reconnect would leave the panel silent about a seat that is still stalling.
 */
export function noteAfter(note: Note | null, event: TableEvent, now: number): Note | null {
  switch (event.t) {
    case 'turn':
      return { kind: 'turn', name: event.name, until: now + event.seconds * 1000 };
    case 'away':
      // Zero seconds means the bot already has it: a countdown pinned at nought
      // promises a change that has already happened.
      return event.seconds === 0
        ? { kind: 'bot', name: event.name }
        : { kind: 'away', name: event.name, until: now + event.seconds * 1000 };
    case 'back':
      // Only HIS note. Another man's countdown is still true.
      return note !== null && note.kind !== 'reconnecting' && note.name === event.name
        ? null
        : note;
    case 'connection':
      if (event.state === 'reconnecting') {
        // Nothing to say about a seat is the only case where this takes the
        // screen; otherwise the seat is the more useful thing to show.
        return note === null ? { kind: 'reconnecting' } : note;
      }
      return note?.kind === 'reconnecting' ? null : note;
    default:
      return note;
  }
}

/** The note in whichever language is being read. */
export function noteText(t: T, note: Note, now: number): string {
  const left = (until: number) => Math.max(0, Math.ceil((until - now) / 1000));
  switch (note.kind) {
    case 'turn':
      return t('t.turn', { name: note.name, n: left(note.until) });
    case 'away':
      return t('t.away', { name: note.name, n: left(note.until) });
    case 'bot':
      return t('t.bot', { name: note.name });
    case 'reconnecting':
      return t('t.reconnecting');
  }
}
