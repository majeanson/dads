import { describe, expect, it } from 'vitest';
import type { DraftStore } from '../src/web/drafts';
import {
  CANCEL_PX,
  IDLE,
  holdStep,
  slideOf,
  type Hold,
  type HoldEffect,
  type HoldEvent,
} from '../src/web/holdToTalk';
import { nextRate, readRate, writeRate } from '../src/web/voiceRate';

/** Run a gesture from idle; every effect along the way, in order. */
function run(events: HoldEvent[], from: Hold = IDLE): { end: Hold; effects: HoldEffect[] } {
  let s = from;
  const effects: HoldEffect[] = [];
  for (const e of events) {
    const step = holdStep(s, e);
    s = step.next;
    effects.push(...step.effects);
  }
  return { end: s, effects };
}

describe('hold to talk', () => {
  it('a hold starts recording and buzzes once; lifting sends', () => {
    const { end, effects } = run([
      { t: 'down', x: 300 },
      { t: 'elapsed' },
      { t: 'move', x: 290 },
      { t: 'up', live: true },
    ]);
    expect(effects).toEqual(['start', 'buzz', 'send']);
    // The click the lift becomes is swallowed, not a second recording.
    expect(end.kind).toBe('spent');
    expect(run([{ t: 'click' }], end)).toEqual({ end: IDLE, effects: [] });
  });

  it('nothing starts before the hold', () => {
    expect(run([{ t: 'down', x: 300 }]).effects).toEqual([]);
  });

  it('a tap is a hands-free recording, started by its click', () => {
    const { end, effects } = run([{ t: 'down', x: 300 }, { t: 'up', live: false }, { t: 'click' }]);
    expect(effects).toEqual(['start']);
    expect(end).toEqual(IDLE);
  });

  it('a keyboard click, with no pointer before it, starts it too', () => {
    expect(run([{ t: 'click' }]).effects).toEqual(['start']);
  });

  it('sliding left past the line arms the cancel, buzzing once; lifting throws it away', () => {
    const { end, effects } = run([
      { t: 'down', x: 300 },
      { t: 'elapsed' },
      { t: 'move', x: 300 - CANCEL_PX + 1 },
      { t: 'move', x: 300 - CANCEL_PX },
      { t: 'move', x: 300 - CANCEL_PX - 40 },
      { t: 'up', live: true },
    ]);
    expect(effects).toEqual(['start', 'buzz', 'buzz', 'discard']);
    expect(end.kind).toBe('spent');
  });

  it('coming back from the line disarms it, and lifting then sends', () => {
    const { effects } = run([
      { t: 'down', x: 300 },
      { t: 'elapsed' },
      { t: 'move', x: 200 },
      { t: 'move', x: 280 },
      { t: 'up', live: true },
    ]);
    expect(effects).toEqual(['start', 'buzz', 'buzz', 'send']);
  });

  it('right of where it went down is not further from cancelling', () => {
    const held = run([{ t: 'down', x: 300 }, { t: 'elapsed' }, { t: 'move', x: 400 }]).end;
    expect(held).toMatchObject({ kind: 'held', dx: 0, armed: false });
    expect(slideOf(held)).toBe(0);
  });

  it('the slide is how far toward the cancel, capped at one', () => {
    const at = (x: number) =>
      slideOf(run([{ t: 'down', x: 300 }, { t: 'elapsed' }, { t: 'move', x }]).end);
    expect(at(300 - CANCEL_PX / 2)).toBe(0.5);
    expect(at(0)).toBe(1);
    expect(slideOf(IDLE)).toBe(0);
  });

  it('a pointer taken mid-hold keeps the recording, hands-free', () => {
    const { end, effects } = run([{ t: 'down', x: 300 }, { t: 'elapsed' }, { t: 'lost' }]);
    expect(effects).toEqual(['start', 'buzz']);
    expect(end).toEqual(IDLE);
  });

  it('a pointer taken before the hold started nothing', () => {
    expect(run([{ t: 'down', x: 300 }, { t: 'lost' }])).toEqual({ end: IDLE, effects: [] });
  });

  it('lifting while the microphone is still being asked for goes hands-free', () => {
    const { end, effects } = run([
      { t: 'down', x: 300 },
      { t: 'elapsed' },
      { t: 'up', live: false },
    ]);
    expect(effects).toEqual(['start', 'buzz']);
    expect(end).toEqual(IDLE);
  });

  it('a stale timer and a second finger do nothing', () => {
    expect(run([{ t: 'elapsed' }])).toEqual({ end: IDLE, effects: [] });
    const held = run([{ t: 'down', x: 300 }, { t: 'elapsed' }]).end;
    expect(run([{ t: 'down', x: 10 }, { t: 'elapsed' }], held)).toEqual({ end: held, effects: [] });
  });

  it('a hold whose click never came does not swallow the next tap', () => {
    const spent: Hold = { kind: 'spent' };
    expect(
      run([{ t: 'down', x: 300 }, { t: 'up', live: false }, { t: 'click' }], spent).effects,
    ).toEqual(['start']);
  });
});

function fake(): DraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const refusing: DraftStore = {
  getItem: () => {
    throw new Error('storage is off');
  },
  setItem: () => {
    throw new Error('storage is full');
  },
  removeItem: () => {
    throw new Error('storage is off');
  },
};

describe('voice note speed', () => {
  it('goes 1, 1.5, 2 and round again', () => {
    expect(nextRate(1)).toBe(1.5);
    expect(nextRate(1.5)).toBe(2);
    expect(nextRate(2)).toBe(1);
  });

  it('is remembered on the device, and 1 is kept as nothing', () => {
    const s = fake();
    expect(readRate(s)).toBe(1);
    writeRate(s, 1.5);
    expect(s.map.get('dads.voice.rate')).toBe('1.5');
    expect(readRate(s)).toBe(1.5);
    writeRate(s, 1);
    expect(s.map.size).toBe(0);
  });

  it('reads nonsense, no storage and refusing storage as 1', () => {
    const s = fake();
    s.map.set('dads.voice.rate', '7');
    expect(readRate(s)).toBe(1);
    expect(readRate(null)).toBe(1);
    expect(readRate(refusing)).toBe(1);
    expect(() => writeRate(refusing, 2)).not.toThrow();
  });
});
