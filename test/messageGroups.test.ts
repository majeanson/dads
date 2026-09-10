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
