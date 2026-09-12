import { describe, expect, it } from 'vitest';
import { translator } from '../src/shared/dictionary';
import { noteAfter, noteText, type Note } from '../src/shared/tableNote';

const NOW = 1_000_000;
const t = translator('en');
const fr = translator('fr');

describe('what the table panel says', () => {
  it('starts a countdown for a turn left sitting', () => {
    const note = noteAfter(null, { v: 1, t: 'turn', name: 'Marc', seconds: 20 }, NOW);
    expect(note).toEqual({ kind: 'turn', name: 'Marc', until: NOW + 20_000 });
    expect(noteText(t, note!, NOW)).toBe('Marc’s turn — 20s');
    // Read later, it counts down rather than repeating itself.
    expect(noteText(t, note!, NOW + 15_000)).toBe('Marc’s turn — 5s');
  });

  it('never counts below nought', () => {
    const note: Note = { kind: 'away', name: 'Sam', until: NOW };
    expect(noteText(t, note, NOW + 60_000)).toBe('Sam dropped — bot in 0s');
  });

  it('says a bot has it rather than pinning a countdown at nought', () => {
    // Zero seconds is jaffre saying the swap already happened; a countdown
    // sitting at 0:00 promises a change that is behind us.
    expect(noteAfter(null, { v: 1, t: 'away', name: 'Sam', seconds: 0 }, NOW)).toEqual({
      kind: 'bot',
      name: 'Sam',
    });
    expect(noteAfter(null, { v: 1, t: 'away', name: 'Sam', seconds: 45 }, NOW)).toEqual({
      kind: 'away',
      name: 'Sam',
      until: NOW + 45_000,
    });
  });

  it('clears only the note about the man who came back', () => {
    const sam: Note = { kind: 'bot', name: 'Sam' };
    expect(noteAfter(sam, { v: 1, t: 'back', name: 'Sam' }, NOW)).toBeNull();
    // Another man's countdown is still true.
    expect(noteAfter(sam, { v: 1, t: 'back', name: 'Dave' }, NOW)).toBe(sam);
    expect(noteAfter(null, { v: 1, t: 'back', name: 'Sam' }, NOW)).toBeNull();
  });

  it('does not let a reconnect blip destroy a countdown', () => {
    // The socket coming and going says nothing about whose turn it is, and a
    // seat that is still stalling is the more useful thing to show.
    const turn: Note = { kind: 'turn', name: 'Marc', until: NOW + 9000 };
    expect(noteAfter(turn, { v: 1, t: 'connection', state: 'reconnecting' }, NOW)).toBe(turn);
    expect(noteAfter(turn, { v: 1, t: 'connection', state: 'ok' }, NOW)).toBe(turn);
  });

  it('says it is reconnecting when there is nothing else to say', () => {
    const down = noteAfter(null, { v: 1, t: 'connection', state: 'reconnecting' }, NOW);
    expect(down).toEqual({ kind: 'reconnecting' });
    expect(noteText(t, down!, NOW)).toBe('Reconnecting to the table…');
    // And stops saying it once the socket is back.
    expect(noteAfter(down, { v: 1, t: 'connection', state: 'ok' }, NOW)).toBeNull();
  });

  it('says nothing about the plumbing', () => {
    for (const event of [
      { v: 1, t: 'ready' },
      { v: 1, t: 'game-started' },
      { v: 1, t: 'seated', name: 'Marc' },
      { v: 1, t: 'game-over', summary: '41–37' },
    ] as const) {
      expect(noteAfter(null, event, NOW)).toBeNull();
    }
  });

  it('reads in French too', () => {
    const note = noteAfter(null, { v: 1, t: 'turn', name: 'Marc', seconds: 20 }, NOW);
    expect(noteText(fr, note!, NOW)).toBe('Au tour de Marc — 20s');
  });
});
