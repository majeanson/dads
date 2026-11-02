import { describe, expect, it } from 'vitest';
import {
  AT_REST,
  CLOSE_PX,
  ZOOM_DOUBLE,
  ZOOM_MAX,
  bounds,
  clampView,
  doubleTap,
  dragMove,
  dragStart,
  groundFor,
  isDoubleTap,
  isTap,
  panTo,
  pinchEnd,
  pinchMove,
  pinchStart,
  rubber,
  sidewaysEnd,
  sidewaysOffset,
  verticalEnd,
  verticalOffset,
  zoomAt,
  zoomed,
  type Drag,
} from '../src/web/viewerGestures';

/** Drag from (200, 300) at t=0 through the points, one every `every` ms. */
function drag(points: [number, number][], every = 40, zoomedIn = false): { d: Drag; t: number } {
  let d = dragStart({ x: 200, y: 300 }, 0, zoomedIn);
  let t = 0;
  for (const [x, y] of points) {
    t += every;
    d = dragMove(d, { x, y }, t);
  }
  return { d, t };
}

const SPAN = 400;
const picture = { w: 400, h: 300 };
const stage = { w: 400, h: 600 };

describe('the first ten pixels', () => {
  it('decide nothing under ten', () => {
    expect(drag([[205, 304]]).d.phase).toBe('undecided');
  });
  it('decide sideways when it went more across than down', () => {
    expect(drag([[188, 305]]).d.phase).toBe('sideways');
  });
  it('decide vertical when it went more down (or up) than across', () => {
    expect(drag([[204, 312]]).d.phase).toBe('vertical');
    expect(drag([[204, 288]]).d.phase).toBe('vertical');
  });
  it('stay decided whatever the finger does after', () => {
    expect(
      drag([
        [180, 302],
        [180, 400],
      ]).d.phase,
    ).toBe('sideways');
  });
  it('are skipped when zoomed in: one finger pans', () => {
    expect(drag([[201, 301]], 40, true).d.phase).toBe('pan');
  });
});

describe('sideways', () => {
  it('follows the finger where there is a picture to go to', () => {
    expect(sidewaysOffset(-120, 1, 3, SPAN)).toBe(-120);
    expect(sidewaysOffset(120, 1, 3, SPAN)).toBe(120);
  });

  it('resists at the first and the last picture, and never reaches the span', () => {
    const atFirst = sidewaysOffset(300, 0, 3, SPAN);
    expect(atFirst).toBeGreaterThan(0);
    expect(atFirst).toBeLessThan(300 / 2);
    expect(sidewaysOffset(-300, 2, 3, SPAN)).toBe(-atFirst);
    expect(rubber(100_000, SPAN)).toBeLessThan(SPAN);
    // Going the other way from the first one is not resisted.
    expect(sidewaysOffset(-300, 0, 3, SPAN)).toBe(-300);
  });

  it('moves on past a third of the width, left to the next, right to the one before', () => {
    const left = drag([
      [190, 300],
      [100, 300],
      [60, 300],
    ]);
    expect(sidewaysEnd(left.d, left.t + 200, 1, 3, SPAN)).toBe(1);
    const right = drag([
      [210, 300],
      [300, 300],
      [340, 300],
    ]);
    expect(sidewaysEnd(right.d, right.t + 200, 1, 3, SPAN)).toBe(-1);
  });

  it('springs back under a third, held still', () => {
    const { d, t } = drag([
      [190, 300],
      [120, 300],
    ]);
    expect(sidewaysEnd(d, t + 200, 1, 3, SPAN)).toBe(0);
  });

  it('moves on for a quick flick under a third', () => {
    // 60px in 40ms is 1.5px/ms, lifted straight away.
    const { d, t } = drag([[140, 300]]);
    expect(sidewaysEnd(d, t + 5, 1, 3, SPAN)).toBe(1);
    // A twitch is not a flick, however fast.
    const twitch = drag([[188, 300]], 10);
    expect(sidewaysEnd(twitch.d, twitch.t + 5, 1, 3, SPAN)).toBe(0);
  });

  it('never moves past the ends', () => {
    const { d, t } = drag([
      [190, 300],
      [20, 300],
    ]);
    expect(sidewaysEnd(d, t, 2, 3, SPAN)).toBe(0);
    const back = drag([
      [210, 300],
      [380, 300],
    ]);
    expect(sidewaysEnd(back.d, back.t, 0, 3, SPAN)).toBe(0);
  });
});

describe('down to close', () => {
  it('follows the finger down, and resists up', () => {
    expect(verticalOffset(80, 600)).toBe(80);
    const up = verticalOffset(-80, 600);
    expect(up).toBeLessThan(0);
    expect(up).toBeGreaterThan(-80);
  });

  it('closes past the line, held still', () => {
    const { d, t } = drag([
      [200, 320],
      [205, 300 + CLOSE_PX + 5],
    ]);
    expect(verticalEnd(d, t + 500)).toBe(true);
  });

  it('springs back under it, unless flicked', () => {
    const slow = drag([
      [200, 315],
      [200, 360],
    ]);
    expect(verticalEnd(slow.d, slow.t + 500)).toBe(false);
    const flick = drag([[200, 360]]);
    expect(verticalEnd(flick.d, flick.t + 5)).toBe(true);
  });

  it('never closes upwards', () => {
    const { d, t } = drag([
      [200, 280],
      [200, 100],
    ]);
    expect(verticalEnd(d, t)).toBe(false);
  });

  it('fades the ground with distance, never to nothing', () => {
    expect(groundFor(0)).toBe(1);
    expect(groundFor(-50)).toBe(1);
    expect(groundFor(150)).toBeLessThan(1);
    expect(groundFor(5000)).toBeGreaterThan(0);
  });
});

describe('zoom', () => {
  it('keeps the point under the fingers where it was', () => {
    const v = zoomAt(AT_REST, 2, { x: 50, y: -20 });
    // The picture's point (50, -20) at 1× is drawn at translate + scale × point.
    expect(v.x + v.scale * 50).toBeCloseTo(50);
    expect(v.y + v.scale * -20).toBeCloseTo(-20);
  });

  it('pinches about the midpoint, and stops at 4×', () => {
    const p = pinchStart(AT_REST, { x: -20, y: 0 }, { x: 20, y: 0 });
    const twice = pinchMove(p, { x: -40, y: 0 }, { x: 40, y: 0 });
    expect(twice).toEqual({ scale: 2, x: 0, y: 0 });
    expect(pinchMove(p, { x: -400, y: 0 }, { x: 400, y: 0 }).scale).toBe(ZOOM_MAX);
    // Off-centre: the picture's point under the fingers stays under them.
    const q = pinchStart(AT_REST, { x: 80, y: 40 }, { x: 120, y: 40 });
    const v = pinchMove(q, { x: 60, y: 40 }, { x: 140, y: 40 });
    expect(v.x + v.scale * 100).toBeCloseTo(100);
    expect(v.y + v.scale * 40).toBeCloseTo(40);
  });

  it('may go under 1× while pinching, and snaps back to 1× at rest', () => {
    const p = pinchStart(AT_REST, { x: -100, y: 0 }, { x: 100, y: 0 });
    const small = pinchMove(p, { x: -40, y: 0 }, { x: 40, y: 0 });
    expect(small.scale).toBeLessThan(1);
    expect(pinchEnd(small, picture, stage)).toEqual(AT_REST);
  });

  it('pans only as far as the picture reaches', () => {
    // 2× a 400×300 picture in a 400×600 stage: 200 either way across, 0 up and down.
    expect(bounds(2, picture, stage)).toEqual({ x: 200, y: 0 });
    const from = { scale: 2, x: 0, y: 0 };
    expect(panTo(from, 500, 90, picture, stage)).toEqual({ scale: 2, x: 200, y: 0 });
    expect(panTo(from, -60, 0, picture, stage)).toEqual({ scale: 2, x: -60, y: 0 });
    expect(clampView({ scale: 9, x: 0, y: 0 }, picture, stage).scale).toBe(ZOOM_MAX);
    expect(clampView({ scale: 1, x: 40, y: 40 }, picture, stage)).toEqual(AT_REST);
  });

  it('toggles 1× and 2.5× on a double tap, where it landed', () => {
    const inn = doubleTap(AT_REST, { x: 100, y: 0 }, picture, stage);
    expect(inn.scale).toBe(ZOOM_DOUBLE);
    expect(zoomed(inn)).toBe(true);
    expect(inn.x).toBeLessThan(0);
    expect(doubleTap(inn, { x: 0, y: 0 }, picture, stage)).toEqual(AT_REST);
  });
});

describe('taps', () => {
  it('is a tap when it went nowhere, quickly', () => {
    const { d, t } = drag([[203, 302]]);
    expect(isTap(d, t)).toBe(true);
    expect(isTap(d, t + 1000)).toBe(false);
    expect(isTap(drag([[230, 300]]).d, 50)).toBe(false);
  });

  it('is a double tap when the second comes soon after, near the first', () => {
    const first = { x: 10, y: 10, t: 0 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { x: 15, y: 12, t: 200 })).toBe(true);
    expect(isDoubleTap(first, { x: 15, y: 12, t: 600 })).toBe(false);
    expect(isDoubleTap(first, { x: 120, y: 12, t: 200 })).toBe(false);
  });
});
