import { describe, expect, it } from 'vitest';
import type { RoomMessage } from '../src/shared/protocol';
import { dayLabel, toRows } from '../src/web/messageGroups';

const DAY = 24 * 60 * 60 * 1000;
const NOON = Date.parse('2026-09-09T16:00:00Z');

let seq = 0;
function msg(over: Partial<RoomMessage> & { createdAt: number }): RoomMessage {
  seq += 1;
  return {
    seq,
    id: `msg_${seq}`,
    kind: 'chat',
    memberId: 'mem_marc',
    name: 'Marc',
    body: 'something',
    ...over,
  };
}

function names(rows: ReturnType<typeof toRows>): (string | null)[] {
  return rows.map((r) => (r.kind === 'message' ? (r.showName ? r.message.name : null) : 'DAY'));
}

describe('turns', () => {
  it('names a dad once for a run of his own lines', () => {
    const rows = toRows(
      [
        msg({ createdAt: NOON }),
        msg({ createdAt: NOON + 30_000 }),
        msg({ createdAt: NOON + 60_000 }),
      ],
      NOON,
    );
    expect(names(rows)).toEqual(['DAY', 'Marc', null, null]);
  });

  it('names him again once someone else speaks', () => {
    const rows = toRows(
      [
        msg({ createdAt: NOON }),
        msg({ createdAt: NOON + 10_000, memberId: 'mem_sam', name: 'Sam' }),
        msg({ createdAt: NOON + 20_000 }),
      ],
      NOON,
    );
    expect(names(rows)).toEqual(['DAY', 'Marc', 'Sam', 'Marc']);
  });

  it('names him again after a long enough gap', () => {
    const rows = toRows([msg({ createdAt: NOON }), msg({ createdAt: NOON + 6 * 60_000 })], NOON);
    expect(names(rows)).toEqual(['DAY', 'Marc', 'Marc']);
  });

  it('never folds a system or table line into a turn', () => {
    const rows = toRows(
      [
        msg({ createdAt: NOON }),
        msg({ createdAt: NOON + 1000, kind: 'system', memberId: null, body: 'Sam came in' }),
        msg({ createdAt: NOON + 2000 }),
      ],
      NOON,
    );
    // The room speaking interrupts the turn, so Marc is reintroduced after it.
    // The system line itself carries a name in the data but never renders one.
    expect(rows).toHaveLength(4);
    expect(names(rows)[1]).toBe('Marc');
    expect(names(rows)[3]).toBe('Marc');
  });

  it('keeps every answer to the day’s question announced', () => {
    const rows = toRows(
      [
        msg({ createdAt: NOON, kind: 'prompt', body: 'first thought' }),
        msg({ createdAt: NOON + 5_000, kind: 'prompt', body: 'and another' }),
      ],
      NOON,
    );
    expect(names(rows)).toEqual(['DAY', 'Marc', 'Marc']);
  });
});

describe('days', () => {
  it('opens each day with its own divider', () => {
    const rows = toRows([msg({ createdAt: NOON - DAY }), msg({ createdAt: NOON })], NOON);
    const days = rows.filter((r) => r.kind === 'day');
    expect(days).toHaveLength(2);
    expect(days.map((d) => (d.kind === 'day' ? d.label : ''))).toEqual(['Yesterday', 'Today']);
  });

  it('reintroduces a dad after a day boundary even mid-turn', () => {
    const rows = toRows(
      [
        msg({ createdAt: NOON - DAY }),
        msg({ createdAt: NOON - DAY + 1000 }),
        msg({ createdAt: NOON }),
      ],
      NOON,
    );
    expect(names(rows)).toEqual(['DAY', 'Marc', null, 'DAY', 'Marc']);
  });

  it('says what a person would say', () => {
    expect(dayLabel(NOON, NOON)).toBe('Today');
    expect(dayLabel(NOON - DAY, NOON)).toBe('Yesterday');
    expect(dayLabel(NOON - 5 * DAY, NOON)).toMatch(/\w+day/);
  });

  it('produces nothing at all for an empty room', () => {
    expect(toRows([], NOON)).toEqual([]);
  });
});

describe('new since you were here', () => {
  const since = { seq: 0, label: 'NEW' };
  const kinds = (rows: ReturnType<typeof toRows>) =>
    rows.map((r) => (r.kind === 'message' ? r.message.body : r.kind === 'new' ? 'NEW' : 'DAY'));

  it('sits before the first line after the one he saw', () => {
    const a = msg({ createdAt: NOON, body: 'one' });
    const b = msg({ createdAt: NOON + 1000, body: 'two' });
    const c = msg({ createdAt: NOON + 2000, body: 'three' });
    const rows = toRows([a, b, c], NOON, undefined, { ...since, seq: a.seq });
    expect(kinds(rows)).toEqual(['DAY', 'one', 'NEW', 'two', 'three']);
  });

  it('reintroduces the man he starts reading from', () => {
    const a = msg({ createdAt: NOON, body: 'one' });
    const b = msg({ createdAt: NOON + 1000, body: 'two' });
    const rows = toRows([a, b], NOON, undefined, { ...since, seq: a.seq });
    expect(names(rows)).toEqual(['DAY', 'Marc', 'DAY', 'Marc']);
  });

  it('is nothing when he has seen everything', () => {
    const a = msg({ createdAt: NOON, body: 'one' });
    const b = msg({ createdAt: NOON + 1000, body: 'two' });
    expect(kinds(toRows([a, b], NOON, undefined, { ...since, seq: b.seq }))).toEqual([
      'DAY',
      'one',
      'two',
    ]);
  });

  it('is nothing at the very top of the list', () => {
    // Everything on the screen is newer than what he saw: the whole list is
    // new, and a divider above the first line says nothing a fresh list does
    // not.
    const a = msg({ createdAt: NOON, body: 'one' });
    const b = msg({ createdAt: NOON + 1000, body: 'two' });
    expect(kinds(toRows([a, b], NOON, undefined, { ...since, seq: a.seq - 1 }))).toEqual([
      'DAY',
      'one',
      'two',
    ]);
  });
});
