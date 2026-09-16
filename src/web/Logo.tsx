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
 */
export function Logo({
  size = 28,
  hole,
  className,
}: {
  size?: number;
  hole: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="256" cy="256" r="216" fill="currentColor" />
      <g fill={hole}>
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
