import { useId } from 'react';
import type { GlassesKind } from '../shared/protocol';

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
  slide = 0,
  className,
}: {
  size?: number;
  hole: string;
  motion?: 'on' | 'live' | 'glint';
  /** 0 to 1: how far down the nose a finger has pulled the glasses. */
  slide?: number;
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
      <g
        fill={hole}
        className="logo-glasses"
        style={slide ? { transform: `translateY(${slide * 70}px)` } : undefined}
      >
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

/** A rounded rectangle as a path, so two of them can make a frame. */
function box(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`;
}

/**
 * The pairs themselves, in the app's own coordinates (the shades' box, 80–432
 * across and 196–304 down), so any of them sits where the shades would.
 * `currentColor` is the frame; only the 3D pair has colours of its own,
 * because red and blue ARE the joke.
 */
function Pair({ kind }: { kind: GlassesKind }) {
  switch (kind) {
    case 'aviators':
      return (
        <>
          <rect x="96" y="198" width="320" height="14" rx="7" />
          <path d="M104 214H232Q240 214 238 234Q232 296 172 300Q112 296 104 240Q102 214 104 214Z" />
          <path d="M280 214H408Q410 214 408 240Q400 296 340 300Q280 296 274 234Q272 214 280 214Z" />
        </>
      );
    case 'round':
      // Frames round the glass, not two dots on a stick: a ring each, the
      // glass tinted inside it, and a thin bridge.
      return (
        <>
          <path
            fillRule="evenodd"
            d="M112 252a56 56 0 1 0 112 0a56 56 0 1 0 -112 0ZM126 252a42 42 0 1 0 84 0a42 42 0 1 0 -84 0Z"
          />
          <path
            fillRule="evenodd"
            d="M288 252a56 56 0 1 0 112 0a56 56 0 1 0 -112 0ZM302 252a42 42 0 1 0 84 0a42 42 0 1 0 -84 0Z"
          />
          <path d="M220 240Q256 222 292 240" fill="none" stroke="currentColor" strokeWidth="12" />
          <g opacity="0.35">
            <circle cx="168" cy="252" r="42" />
            <circle cx="344" cy="252" r="42" />
          </g>
        </>
      );
    case 'square':
      return (
        <>
          <path fillRule="evenodd" d={box(92, 204, 152, 96, 10) + box(108, 220, 120, 64, 4)} />
          <path fillRule="evenodd" d={box(268, 204, 152, 96, 10) + box(284, 220, 120, 64, 4)} />
          <rect x="236" y="226" width="40" height="16" rx="6" />
          <g opacity="0.35">
            <rect x="108" y="220" width="120" height="64" rx="4" />
            <rect x="284" y="220" width="120" height="64" rx="4" />
          </g>
        </>
      );
    case '3d':
      return (
        <>
          <path
            fillRule="evenodd"
            d={box(88, 204, 336, 96, 14) + box(104, 220, 136, 64, 6) + box(272, 220, 136, 64, 6)}
          />
          <rect x="104" y="220" width="136" height="64" rx="6" fill="#e0413c" />
          <rect x="272" y="220" width="136" height="64" rx="6" fill="#22a6c9" />
        </>
      );
    case 'goggles':
      return (
        <>
          <rect x="80" y="236" width="352" height="18" rx="9" opacity="0.6" />
          <rect x="100" y="206" width="312" height="96" rx="48" />
          <path
            d="M140 226Q200 214 250 222"
            fill="none"
            stroke="var(--bg)"
            strokeWidth="10"
            strokeLinecap="round"
            opacity="0.5"
          />
        </>
      );
    default:
      return (
        <>
          <rect x="80" y="196" width="352" height="34" rx="17" />
          <rect x="102" y="214" width="132" height="90" rx="38" />
          <rect x="278" y="214" width="132" height="90" rx="38" />
        </>
      );
  }
}

/**
 * The glasses alone — the app's symbol, worn by whoever it is about.
 *
 * On every face (`Face`) — HIS pair, the one he chose in Settings (`kind`),
 * the app's shades if he never did. Beside a name while he types, they bob.
 * `drop` has them come down as they appear. Decorative: the words nearby
 * always say the same thing.
 */
export function Glasses({
  width = 24,
  kind = 'shades',
  drop = false,
  delay = 0,
  className,
}: {
  width?: number;
  kind?: GlassesKind;
  drop?: boolean;
  /** Milliseconds before they come down, so a row can come down as a wave. */
  delay?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="80 196 352 108"
      width={width}
      height={Math.round((width * 108) / 352)}
      aria-hidden="true"
      focusable="false"
      data-glasses={kind}
      className={[drop ? 'logo-anim' : '', className ?? ''].join(' ')}
    >
      <g
        fill="currentColor"
        className="logo-glasses"
        style={delay ? { animationDelay: `${delay}ms` } : undefined}
      >
        <Pair kind={kind} />
      </g>
    </svg>
  );
}
