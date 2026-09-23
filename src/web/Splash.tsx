import { useEffect, useId } from 'react';

/** Where the left lens sits in the mark's 512 square, as fractions of it. */
export const LEFT_LENS = { x: 102 / 512, y: 214 / 512, w: 132 / 512, h: 90 / 512, r: 38 / 512 };

/** How long the whole thing runs before it takes itself away. */
const SPLASH_MS = 1650;

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
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const mask = useId();

  useEffect(() => {
    const timer = setTimeout(onDone, SPLASH_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  const huge = { x: -20000, y: -20000, width: 40000, height: 40000 };

  return (
    <div className="splash" aria-hidden="true" data-testid="splash">
      <svg
        viewBox="0 0 512 512"
        className="splash-mark"
        style={{
          transformOrigin: `${(LEFT_LENS.x + LEFT_LENS.w / 2) * 100}% ${(LEFT_LENS.y + LEFT_LENS.h / 2) * 100}%`,
        }}
        overflow="visible"
      >
        <defs>
          <mask id={mask} maskUnits="userSpaceOnUse" {...huge}>
            <rect {...huge} fill="white" />
            <g className="splash-glasses" fill="black">
              <rect x="102" y="214" width="132" height="90" rx="38" />
              <rect x="278" y="214" width="132" height="90" rx="38" />
            </g>
          </mask>
        </defs>
        <g mask={`url(#${mask})`}>
          <rect {...huge} fill="var(--accent)" />
          <circle className="splash-face" cx="256" cy="256" r="216" fill="var(--on-accent)" />
          <g className="splash-glasses" fill="var(--accent)">
            <rect x="80" y="196" width="352" height="34" rx="17" />
          </g>
          <path
            d="M196 350 q60 48 120 0"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="24"
            strokeLinecap="round"
          />
        </g>
        {/* Smoked glass over the windows, so they read as sunglasses — and it
            lifts as he goes in, so the app is clear by the time he is there. */}
        <g className="splash-glasses">
          <g className="splash-tint" fill="var(--accent)">
            <rect x="102" y="214" width="132" height="90" rx="38" />
            <rect x="278" y="214" width="132" height="90" rx="38" />
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
