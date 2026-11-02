/**
 * The photo viewer's gestures (Marc, 2026-11-02: the ones every phone has).
 *
 * With no DOM in it, so the worker pool can test it; `Viewer.tsx` feeds it
 * pointer positions and paints what it answers. Same shape as `swipe.ts`:
 * the first ten pixels decide the direction, and nothing commits until the
 * finger lifts.
 *
 * - Sideways moves to the picture before or after: past a third of the width,
 *   or a flick, it goes; under that it springs back. At the first or the last
 *   picture the finger meets resistance and it comes back.
 * - Downwards takes the picture with the finger and fades the black; past
 *   `CLOSE_PX`, or a flick, lifting closes the viewer. Upwards is resistance
 *   and back.
 * - Two fingers zoom about their midpoint, 1× to 4×; once zoomed one finger
 *   pans inside the picture's bounds and the two swipes are off. A double tap
 *   goes to 2.5× where it landed, and back.
 *
 * A view is the picture's `translate` (x, y, px, from where it sits at rest)
 * and its `scale`, about its own centre — which is the stage's centre. Every
 * point handed in here is relative to that centre.
 */

/** The first movement decides the direction. */
export const DECIDE_PX = 10;
/** Down past this, lifting closes. */
export const CLOSE_PX = 100;
/** A flick: faster than this (px per ms) at the lift... */
export const FLICK_SPEED = 0.5;
/** ...and at least this far, so a twitch is not a flick. */
export const FLICK_MIN_PX = 30;
/** Speed is measured over at least this long, so one close pair of events is not a flick. */
const SPEED_WINDOW_MS = 30;
/** A finger that stopped this long before lifting was not flicking. */
const STILL_MS = 100;
export const ZOOM_MAX = 4;
export const ZOOM_DOUBLE = 2.5;
/** A pinch may go under 1× while the fingers are on; it snaps back to 1×. */
export const PINCH_FLOOR = 0.6;
export const TAP_MS = 300;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export interface View {
  scale: number;
  x: number;
  y: number;
}
export const AT_REST: View = { scale: 1, x: 0, y: 0 };

/** One finger on the picture. */
export interface Drag {
  phase: 'undecided' | 'sideways' | 'vertical' | 'pan';
  x0: number;
  y0: number;
  t0: number;
  dx: number;
  dy: number;
  /** The furthest it has been from where it went down, either way. */
  far: number;
  /** Where the speed is measured from, and the speed so far. */
  sx: number;
  sy: number;
  st: number;
  vx: number;
  vy: number;
  /** When it last moved. */
  lt: number;
}

/** A finger went down. Zoomed in, it pans from the start. */
export function dragStart(p: Point, t: number, zoomedIn: boolean): Drag {
  return {
    phase: zoomedIn ? 'pan' : 'undecided',
    x0: p.x,
    y0: p.y,
    t0: t,
    dx: 0,
    dy: 0,
    far: 0,
    sx: p.x,
    sy: p.y,
    st: t,
    vx: 0,
    vy: 0,
    lt: t,
  };
}

export function dragMove(d: Drag, p: Point, t: number): Drag {
  const dx = p.x - d.x0;
  const dy = p.y - d.y0;
  const far = Math.max(d.far, Math.abs(dx), Math.abs(dy));
  let { phase, sx, sy, st, vx, vy } = d;
  if (t - st >= SPEED_WINDOW_MS) {
    vx = (p.x - sx) / (t - st);
    vy = (p.y - sy) / (t - st);
    sx = p.x;
    sy = p.y;
    st = t;
  }
  if (phase === 'undecided' && Math.max(Math.abs(dx), Math.abs(dy)) >= DECIDE_PX)
    phase = Math.abs(dx) > Math.abs(dy) ? 'sideways' : 'vertical';
  return { ...d, phase, dx, dy, far, sx, sy, st, vx, vy, lt: t };
}

/** How fast it was going when it lifted at `t`; nothing if it had stopped. */
export function speed(d: Drag, t: number): Point {
  if (t - d.lt > STILL_MS) return { x: 0, y: 0 };
  return { x: d.vx, y: d.vy };
}

/** A finger that went down and came up without going anywhere. */
export function isTap(d: Drag, t: number): boolean {
  return d.far < DECIDE_PX && t - d.t0 < TAP_MS;
}

export interface Tap {
  x: number;
  y: number;
  t: number;
}

export function isDoubleTap(previous: Tap | null, now: Tap): boolean {
  if (previous === null) return false;
  return (
    now.t - previous.t < DOUBLE_TAP_MS &&
    Math.hypot(now.x - previous.x, now.y - previous.y) < DOUBLE_TAP_PX
  );
}

/**
 * Resistance: the further the finger goes, the less the picture follows,
 * never past `dim`. The curve iOS's own rubber band is usually described by.
 */
export function rubber(d: number, dim: number): number {
  if (d === 0 || dim <= 0) return 0;
  return Math.sign(d) * (1 - 1 / ((Math.abs(d) * 0.55) / dim + 1)) * dim;
}

/** Where the picture sits for a sideways finger `dx` from where it went down. */
export function sidewaysOffset(dx: number, at: number, total: number, span: number): number {
  const nothingThere = (dx > 0 && at <= 0) || (dx < 0 && at >= total - 1);
  return nothingThere ? rubber(dx, span) : dx;
}

/**
 * The lift of a sideways drag: +1 for the next picture (the finger went
 * left), -1 for the one before, 0 to spring back.
 */
export function sidewaysEnd(d: Drag, t: number, at: number, total: number, span: number): number {
  if (d.phase !== 'sideways' || d.dx === 0) return 0;
  const step = d.dx < 0 ? 1 : -1;
  if (at + step < 0 || at + step > total - 1) return 0;
  const v = speed(d, t).x;
  const far = Math.abs(d.dx) > span / 3;
  const flick =
    Math.abs(v) > FLICK_SPEED && Math.abs(d.dx) >= FLICK_MIN_PX && Math.sign(v) === Math.sign(d.dx);
  return far || flick ? step : 0;
}

/** Where the picture sits for a vertical finger `dy`: down follows, up resists. */
export function verticalOffset(dy: number, height: number): number {
  return dy >= 0 ? dy : rubber(dy, height);
}

/** The lift of a vertical drag: whether it closes the viewer. */
export function verticalEnd(d: Drag, t: number): boolean {
  if (d.phase !== 'vertical' || d.dy <= 0) return false;
  const v = speed(d, t).y;
  return d.dy >= CLOSE_PX || (v > FLICK_SPEED && d.dy >= FLICK_MIN_PX);
}

/** How black the ground still is with the picture `dy` down: it fades, never all the way. */
export function groundFor(dy: number): number {
  return 1 - Math.min(0.8, Math.max(0, dy) / 300);
}

export function zoomed(v: View): boolean {
  return v.scale > 1.01;
}

/** How far the picture may travel either way at `scale` before an edge comes inside the stage. */
export function bounds(scale: number, picture: Size, stage: Size): Point {
  return {
    x: Math.max(0, (scale * picture.w - stage.w) / 2),
    y: Math.max(0, (scale * picture.h - stage.h) / 2),
  };
}

const within = (n: number, limit: number) => Math.max(-limit, Math.min(limit, n));

/** A view the picture can rest in: 1× to 4×, never showing past its own edge. */
export function clampView(v: View, picture: Size, stage: Size): View {
  const scale = Math.min(ZOOM_MAX, v.scale);
  if (scale <= 1) return AT_REST;
  const b = bounds(scale, picture, stage);
  return { scale, x: within(v.x, b.x), y: within(v.y, b.y) };
}

/** Scale to `scale`, keeping the point of the picture under `m` under `m`. */
export function zoomAt(v: View, scale: number, m: Point): View {
  const k = scale / v.scale;
  return { scale, x: m.x - k * (m.x - v.x), y: m.y - k * (m.y - v.y) };
}

/** One finger, zoomed: the picture follows it, inside its bounds. */
export function panTo(from: View, dx: number, dy: number, picture: Size, stage: Size): View {
  return clampView({ ...from, x: from.x + dx, y: from.y + dy }, picture, stage);
}

export interface Pinch {
  from: View;
  d0: number;
  /** The point of the picture (at 1×, from its centre) the fingers went down around. */
  held: Point;
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function pinchStart(v: View, a: Point, b: Point): Pinch {
  const m = mid(a, b);
  return {
    from: v,
    d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    held: { x: (m.x - v.x) / v.scale, y: (m.y - v.y) / v.scale },
  };
}

/** Two fingers: the scale goes with their spread, and what was between them stays between them. */
export function pinchMove(p: Pinch, a: Point, b: Point): View {
  const raw = (p.from.scale * Math.hypot(a.x - b.x, a.y - b.y)) / p.d0;
  const scale = Math.max(PINCH_FLOOR, Math.min(ZOOM_MAX, raw));
  const m = mid(a, b);
  return { scale, x: m.x - scale * p.held.x, y: m.y - scale * p.held.y };
}

/** The fingers lifted: under 1× is 1×, and the picture comes back inside its bounds. */
export function pinchEnd(v: View, picture: Size, stage: Size): View {
  return clampView(v, picture, stage);
}

/** A double tap: zoomed in, back to rest; at rest, 2.5× where it landed. */
export function doubleTap(v: View, m: Point, picture: Size, stage: Size): View {
  if (zoomed(v)) return AT_REST;
  return clampView(zoomAt(v, ZOOM_DOUBLE, m), picture, stage);
}
