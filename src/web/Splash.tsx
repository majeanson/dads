import { useEffect, useId, useRef } from 'react';

/** Where the left lens sits in the mark's 512 square, as fractions of it. */
export const LEFT_LENS = { x: 102 / 512, y: 214 / 512, w: 132 / 512, h: 90 / 512, r: 38 / 512 };
/** And the right one: the conversation is through the other eye. */
export const RIGHT_LENS = { ...LEFT_LENS, x: 278 / 512 };
type Lens = typeof LEFT_LENS;

/**
 * The two ways in, as one film at two tempos through two eyes.
 *
 * OPENING the app is the full welcome — the face, the glasses coming down
 * with time to see them, the zoom into the LEFT lens. GOING INTO the
 * conversation is something a man does ten times an evening, so it is the
 * same film quicker, through the RIGHT lens, and with CLEAR glass: the app
 * opens mysterious behind smoked lenses, the talk opens bright. Related,
 * never a replay.
 *
 * Times in ms from the start: when the glasses start down and for how long,
 * when the zoom starts and for how long, when the smoked glass starts to lift
 * and for how long, and when the whole thing takes itself away.
 */
const PACE = {
  open: {
    lens: LEFT_LENS,
    smoked: true,
    drop: [200, 650],
    zoom: [950, 620],
    lift: [1000, 420],
    end: 1650,
  },
  talk: {
    lens: RIGHT_LENS,
    smoked: false,
    drop: [60, 320],
    zoom: [380, 420],
    lift: [0, 1],
    end: 850,
  },
} as const;

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
function zoomToFill(box: Box, lens: Lens): number {
  const hw = (lens.w * box.width) / 2;
  const hh = (lens.h * box.height) / 2;
  const cx = box.left + (lens.x + lens.w / 2) * box.width;
  const cy = box.top + (lens.y + lens.h / 2) * box.height;
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
  way = 'open',
}: {
  onDone: () => void;
  /** The blue covers the screen and the lenses are not windows yet, so what
   * is underneath can change without anybody seeing it change. */
  onCovered?: () => void;
  /** Opening the app, or going into the conversation. */
  way?: keyof typeof PACE;
}) {
  const pace = PACE[way];
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
  const cx = box.left + (pace.lens.x + pace.lens.w / 2) * box.width;
  const cy = box.top + (pace.lens.y + pace.lens.h / 2) * box.height;
  const zoom = zoomToFill(box, pace.lens);
  const place = `translate(${box.left} ${box.top}) scale(${k})`;

  // Driven frame by frame rather than by CSS: the lenses are holes in a MASK,
  // and Chrome does not reliably repaint a mask whose contents move by CSS
  // animation — the holes lagged the drawn glasses and the lenses doubled.
  // An attribute set every frame is repainted every frame.
  useEffect(() => {
    const [dropAt, dropFor] = pace.drop;
    const [zoomAt, zoomFor] = pace.zoom;
    const [liftAt, liftFor] = pace.lift;
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
      const d = clamp01((t - dropAt) / dropFor);
      const dy = -151 * (1 - easeOutBack(d));
      const op = String(clamp01(d / 0.45));
      for (const g of drops.current) {
        g?.setAttribute('transform', `translate(0 ${dy})`);
        g?.setAttribute('opacity', op);
      }
      tint.current?.setAttribute('opacity', String(0.72 * (1 - clamp01((t - liftAt) / liftFor))));
      if (t < pace.end) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // What the splash DOES runs on timers, never on frames. A browser that is
    // not painting — a tab in the background, a phone waking up, a loaded
    // test machine — does not run animation frames, and a switch to the
    // conversation that waited on one never happened: "Va jaser" pressed,
    // home still showing. The frames only draw.
    //
    // The lenses are windows only once the glasses start coming down, so that
    // is the last moment the screen underneath can change unseen.
    const covering = setTimeout(cover, dropAt);
    const ending = setTimeout(onDone, pace.end);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(covering);
      clearTimeout(ending);
      // However it ends, whatever was waiting on the cover still happens.
      cover();
    };
  }, [pace, zoom, cx, cy, onDone, onCovered]);

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
              <g
                ref={tint}
                fill="var(--accent)"
                opacity="0.72"
                display={pace.smoked ? undefined : 'none'}
              >
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
