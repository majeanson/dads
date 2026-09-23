import { useId } from 'react';

/**
 * The app's own mark, inline.
 *
 * The same dad in sunglasses as `public/icon.svg`, minus the blue square:
 * wherever this sits, the thing it sits on is the square. The face is drawn
 * in `currentColor` and the glasses and the smile are cut through to `hole`,
 * which the caller sets to whatever is underneath — so on a filled button it
 * is the button's text colour with the button's own fill showing through, and
 * it reads in both themes with no colour of its own. The artwork's fixed hexes
 * would put a pale face on the pale-blue accent that dark mode uses.
 *
 * Decorative wherever it appears: the words beside it are the name.
 *
 * `motion` is the only liveliness the mark has: `on` puts the glasses on as
 * it arrives (the door, home), `live` has them nod now and then while a dad
 * night is actually happening, and `glint` runs a light across the lenses
 * while the app is waiting on something — the room answering, a list
 * arriving. All of them stop dead for a phone set to reduce motion.
 *
 * The glasses are the app's symbol (2026-09-22): the splash zooms into a
 * lens, going into the conversation goes through one, a dad who is coming
 * wears a pair, and a dad typing is a pair bobbing beside his name.
 */
export function Logo({
  size = 28,
  hole,
  motion,
  className,
}: {
  size?: number;
  hole: string;
  motion?: 'on' | 'live' | 'glint';
  className?: string;
}) {
  const clip = useId();
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={[
        motion === 'on'
          ? 'logo-anim'
          : motion === 'live'
            ? 'logo-live'
            : motion === 'glint'
              ? 'logo-glint'
              : '',
        className ?? '',
      ].join(' ')}
    >
      <circle cx="256" cy="256" r="216" fill="currentColor" />
      <g fill={hole} className="logo-glasses">
        <rect x="80" y="196" width="352" height="34" rx="17" />
        <rect x="102" y="214" width="132" height="90" rx="38" />
        <rect x="278" y="214" width="132" height="90" rx="38" />
      </g>
      <path
        d="M196 350 q60 48 120 0"
        fill="none"
        stroke={hole}
        strokeWidth="24"
        strokeLinecap="round"
      />
      {motion === 'glint' ? (
        <>
          <clipPath id={clip}>
            <rect x="102" y="214" width="132" height="90" rx="38" />
            <rect x="278" y="214" width="132" height="90" rx="38" />
          </clipPath>
          <g clipPath={`url(#${clip})`}>
            <rect
              className="logo-glint-bar"
              x="40"
              y="150"
              width="60"
              height="220"
              fill="currentColor"
              opacity="0.55"
            />
          </g>
        </>
      ) : null}
    </svg>
  );
}

/**
 * The glasses alone — the app's symbol, worn by whoever it is about.
 *
 * On a face in "who's coming", a dad who is in has them on. Beside a name
 * while he types, they bob. `drop` has them come down as they appear.
 * Decorative: the words nearby always say the same thing.
 */
export function Glasses({
  width = 24,
  drop = false,
  className,
}: {
  width?: number;
  drop?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="80 196 352 108"
      width={width}
      height={Math.round((width * 108) / 352)}
      aria-hidden="true"
      focusable="false"
      className={[drop ? 'logo-anim' : '', className ?? ''].join(' ')}
    >
      <g fill="currentColor" className="logo-glasses">
        <rect x="80" y="196" width="352" height="34" rx="17" />
        <rect x="102" y="214" width="132" height="90" rx="38" />
        <rect x="278" y="214" width="132" height="90" rx="38" />
      </g>
    </svg>
  );
}
