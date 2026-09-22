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
 * it arrives (the door, home), and `live` has them nod now and then while a
 * dad night is actually happening — the one moment worth the app looking
 * awake. Both stop dead for a phone set to reduce motion.
 */
export function Logo({
  size = 28,
  hole,
  motion,
  className,
}: {
  size?: number;
  hole: string;
  motion?: 'on' | 'live';
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={[
        motion === 'on' ? 'logo-anim' : motion === 'live' ? 'logo-live' : '',
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
    </svg>
  );
}
