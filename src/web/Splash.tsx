import { useEffect, useId, useRef } from 'react';

/** Where the left lens sits in the mark's 512 square, as fractions of it. */
export const LEFT_LENS = { x: 102 / 512, y: 214 / 512, w: 132 / 512, h: 90 / 512, r: 38 / 512 };

/** How long the whole thing runs before it takes itself away. */
const SPLASH_MS = 1650;

/** A box on the screen, in viewport pixels. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How far to zoom a mark in `box` about its left lens for the lens to cover
 * the screen, with a little to spare.
 */
function zoomToFill(box: Box): number {
  const hw = (LEFT_LENS.w * box.width) / 2;
  const hh = (LEFT_LENS.h * box.height) / 2;
  const cx = box.left + (LEFT_LENS.x + LEFT_LENS.w / 2) * box.width;
  const cy = box.top + (LEFT_LENS.y + LEFT_LENS.h / 2) * box.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return Math.max(cx / hw, (vw - cx) / hw, cy / hh, (vh - cy) / hh) * 1.05;
}

/**
 * The app opening, through the glasses.
 *
 * The mark on its blue ground, the glasses coming down onto the face — and
 * the lenses are WINDOWS: they are cut through the ground, so what shows
 * through them is the app itself, already there underneath. Then it zooms
 * into the left lens until the lens is the whole screen, and the app is
 * simply what he is looking at.
 *
 * Nothing waits on it. The room behind has been connecting the whole time, it
 * takes no pointer events, and it is not drawn at all for a phone set to
 * reduce motion — a splash that has to be sat through is a door, not a
 * welcome.
 *
 * "Go and talk" plays exactly this too (2026-09-23), with the conversation
 * as what is inside the lens. Two versions of its own were tried — a zoom from
 * the mark on the door's button, then the button itself growing — and neither
 * felt right; this one did, so there is one animation, not two.
 */
/** Overshoot on the way in, like the CSS spring the rest of the app uses. */
function easeOutBack(t: number): number {
  const c = 1.4;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}
/** Slow out, slow in: the flight starts gently and lands gently. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export function Splash({
  onDone,
  onCovered,
}: {
  onDone: () => void;
  /** The blue covers the screen and the lenses are not windows yet, so what
   * is underneath can change without anybody seeing it change. */
  onCovered?: () => void;
}) {
  const mask = useId();
  const zooms = useRef<(SVGGElement | null)[]>([]);
  const drops = useRef<(SVGGElement | null)[]>([]);
  const tint = useRef<SVGGElement | null>(null);

  // One SVG exactly the size of the screen, and only the mark inside it
  // scales. The first version scaled a whole SVG with a forty-thousand-unit
  // ground in it, and past a hundredfold zoom Chrome ran out of tile memory
  // and died — nothing painted here may ever be bigger than the screen.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const size = Math.min(vw * 0.48, 208);
  const box: Box = {
    left: (vw - size) / 2,
    top: (vh - size) / 2,
    width: size,
    height: size,
  };
  const k = box.width / 512;
  const cx = box.left + (LEFT_LENS.x + LEFT_LENS.w / 2) * box.width;
  const cy = box.top + (LEFT_LENS.y + LEFT_LENS.h / 2) * box.height;
  const zoom = zoomToFill(box);
  const place = `translate(${box.left} ${box.top}) scale(${k})`;

  // Driven frame by frame rather than by CSS: the lenses are holes in a MASK,
  // and Chrome does not reliably repaint a mask whose contents move by CSS
  // animation — the holes lagged the drawn glasses and the lenses doubled.
  // An attribute set every frame is repainted every frame.
  useEffect(() => {
    const zoomAt = 950;
    const zoomFor = 620;
    const start = performance.now();
    let frame = 0;
    let covered = false;
    const cover = () => {
      if (covered) return;
      covered = true;
      onCovered?.();
    };
    const tick = (now: number) => {
      const t = now - start;
      // Geometric, not linear: each frame grows by the same FACTOR, which is
      // what a steady flight towards something looks like. Linear scale
      // crawls at the start and rushes the last frames.
      const z = zoom ** easeInOut(clamp01((t - zoomAt) / zoomFor));
      const zt = `translate(${cx} ${cy}) scale(${z}) translate(${-cx} ${-cy})`;
      for (const g of zooms.current) g?.setAttribute('transform', zt);
      // The glasses start coming down at 200ms and the lenses are windows only
      // from then, so this is the last moment the screen underneath can
      // change unseen: from here the conversation is only seen through them.
      if (t >= 200) cover();
      const d = clamp01((t - 200) / 650);
      const dy = -151 * (1 - easeOutBack(d));
      const op = String(clamp01(d / 0.45));
      for (const g of drops.current) {
        g?.setAttribute('transform', `translate(0 ${dy})`);
        g?.setAttribute('opacity', op);
      }
      tint.current?.setAttribute('opacity', String(0.72 * (1 - clamp01((t - 1000) / 420))));
      if (t < SPLASH_MS) frame = requestAnimationFrame(tick);
      else onDone();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // However it ends, whatever was waiting on the cover still happens.
      cover();
    };
  }, [zoom, cx, cy, onDone, onCovered]);

  const lenses = (
    <>
      <rect x="102" y="214" width="132" height="90" rx="38" />
      <rect x="278" y="214" width="132" height="90" rx="38" />
    </>
  );
  const zoomer = (i: number) => (el: SVGGElement | null) => {
    zooms.current[i] = el;
  };
  const dropper = (i: number) => (el: SVGGElement | null) => {
    drops.current[i] = el;
  };

  return (
    <div className="splash" aria-hidden="true" data-testid="splash">
      <svg width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
        <defs>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={vw} height={vh}>
            <rect width={vw} height={vh} fill="white" />
            <g ref={zoomer(0)}>
              <g transform={place}>
                <g ref={dropper(0)} fill="black">
                  {lenses}
                </g>
              </g>
            </g>
          </mask>
        </defs>
        <g mask={`url(#${mask})`}>
          <rect width={vw} height={vh} fill="var(--accent)" />
          <g ref={zoomer(1)}>
            <g transform={place}>
              <circle className="splash-face" cx="256" cy="256" r="216" fill="var(--on-accent)" />
              <g ref={dropper(1)} fill="var(--accent)">
                <rect x="80" y="196" width="352" height="34" rx="17" />
                {/* The frames. In dark mode the face and the conversation are
                    both near-black, and without a rim nothing said where the
                    glass ended — the flight landed on a black screen instead
                    of going through a lens. Half the stroke falls in the hole
                    and is masked away; the half on the face is the frame. */}
                <g fill="none" stroke="var(--accent)" strokeWidth="12">
                  <rect x="102" y="214" width="132" height="90" rx="38" />
                  <rect x="278" y="214" width="132" height="90" rx="38" />
                </g>
              </g>
              <path
                d="M196 350 q60 48 120 0"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="24"
                strokeLinecap="round"
              />
            </g>
          </g>
        </g>
        {/* Smoked glass over the windows, so they read as sunglasses — and it
            lifts as he goes in, so the app is clear by the time he is there. */}
        <g ref={zoomer(2)}>
          <g transform={place}>
            <g ref={dropper(2)}>
              <g ref={tint} fill="var(--accent)" opacity="0.72">
                {lenses}
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

/** Whether this phone has asked for less motion. */
export function wantsStill(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
