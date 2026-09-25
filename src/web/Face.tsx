import { faceUrl } from './api';
import { dadVar } from './dadColour';
import type { CSSProperties } from 'react';
import type { GlassesKind } from '../shared/protocol';
import { Glasses } from './Logo';
import { useMember } from './members';
import { cn } from './ui/cn';

/**
 * A dad, at a glance.
 *
 * His picture when he has set one. When he has not, his COLOUR with his
 * glasses and a smile on it (2026-09-24) — never an empty grey circle, and no
 * longer his initials: the glasses sat across the letters, and a face made of
 * a colour, a pair and a smile reads as a face where two letters under a pair
 * of glasses read as a mistake. Telling five men apart is the colour, the
 * pair and the name beside it; two dads can share a colour, and the name is
 * what settles it.
 *
 * He wears his glasses on it, always (2026-09-24): the pair he chose in
 * Settings, the app's shades if he never did. They are part of his face now,
 * not a sign of anything — choosing a pair that showed only while he was
 * "in" or typing looked like choosing had done nothing. `wear` is only how
 * they MOVE: `drop` comes down (the night's "in", the full table's wave),
 * `bob` is him typing.
 *
 * Decorative by default: wherever this appears the name is already beside it,
 * and a screen reader announcing "Marc, photo of Marc, Marc" is worse than
 * silence. `className` places the face.
 *
 * His picture and his pair come from `members` (`useMember`), never from the
 * caller: one list, so no screen can draw a face out of date.
 */
export function Face({
  memberId,
  photo,
  tryOn,
  wear = 'still',
  delay = 0,
  size = 28,
  className,
}: {
  memberId: string;
  /**
   * What he has just done to his picture, ahead of the room saying so: a
   * picture just chosen (its URL), or none (`false`) just after he took it
   * off — otherwise the old one came back for a moment before the room
   * caught up. Absent or null: whatever the room has.
   */
  photo?: string | false | null;
  /** A pair to show him in instead of his own: the picker, trying them on. */
  tryOn?: GlassesKind;
  wear?: 'still' | 'drop' | 'bob';
  /** Milliseconds before a `drop`, so a row can come down as a wave. */
  delay?: number;
  size?: number;
  className?: string;
}) {
  const dad = useMember(memberId);
  const glasses = tryOn ?? dad?.glasses;
  const src = photo === false ? null : (photo ?? faceUrl(memberId, dad?.face));
  // His colour, as a ring inside the circle: an outline, so it shows on a
  // photograph as well as on his colour.
  const box = {
    width: size,
    height: size,
    outline: `${size >= 28 ? 2 : 1.5}px solid ${dadVar(memberId)}`,
    outlineOffset: `-${size >= 28 ? 2 : 1.5}px`,
  } as const;

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn('relative inline-block shrink-0', className)}
    >
      {src === null ? (
        // His colour, softened (`.face-blank`, where audit:contrast reads the
        // mix from) so the ink glasses and smile on it read in both themes;
        // the ring keeps the colour at full strength.
        <span
          style={{ ...box, '--dad': dadVar(memberId) } as CSSProperties}
          className="face-blank block rounded-full"
        >
          <svg viewBox="0 0 20 20" className="face-smile" aria-hidden="true" focusable="false">
            <path d="M6.5 13.2 Q10 16.2 13.5 13.2" />
          </svg>
        </span>
      ) : (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          style={box}
          className="block rounded-full object-cover"
        />
      )}
      <Glasses
        kind={glasses}
        drop={wear === 'drop'}
        delay={delay}
        halo
        className={cn('face-shades', wear === 'bob' && 'face-typing')}
      />
    </span>
  );
}

/**
 * A few dads at once: faces overlapping, the newest arrival popping in.
 *
 * For "who is coming" and "who is here", where the words beside it still say
 * who — a man wants to know whether HIS friend is coming, and a face is how
 * that is answered at a glance while the names answer it for sure. So this is
 * decorative too. Past `max` the rest are a count, not more faces: a stack of
 * nine circles is a smudge.
 *
 * `ring` is the colour of whatever it sits on, so each face is cut out of the
 * one behind it rather than drawn over it. `tint` is the fill behind the
 * "+n" past `max`.
 */
export function FaceStack({
  people,
  size = 28,
  max = 5,
  ring,
  tint,
  wave = false,
  className,
}: {
  /** `shades`: this dad is coming, and his glasses come DOWN to say so. */
  /** `arrived`: he has just come in, and his face says so, once. */
  people: {
    memberId: string;
    shades?: boolean;
    arrived?: boolean;
    /** He is typing right now: his glasses bob on his face. */
    typing?: boolean;
  }[];
  size?: number;
  max?: number;
  ring: string;
  tint?: string;
  /** The full table: every pair of shades comes down in turn. */
  wave?: boolean;
  className?: string;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const overlap = Math.round(size * 0.3);

  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center', className)}>
      {shown.map((p, i) => (
        <span
          key={p.memberId}
          className={cn('motion-pop relative inline-flex rounded-full', p.arrived && 'face-arrive')}
          style={
            {
              marginLeft: i === 0 ? 0 : -overlap,
              boxShadow: `0 0 0 2px ${ring}`,
              '--ring': ring,
            } as CSSProperties
          }
        >
          <Face
            memberId={p.memberId}
            wear={p.typing ? 'bob' : p.shades ? 'drop' : 'still'}
            delay={p.shades && wave ? 150 + i * 110 : 0}
            size={size}
          />
        </span>
      ))}
      {rest > 0 ? (
        <span
          className={cn(
            'inline-grid place-items-center rounded-full bg-panel text-xs font-semibold text-muted',
            tint,
          )}
          style={{
            width: size,
            height: size,
            marginLeft: -overlap,
            boxShadow: `0 0 0 2px ${ring}`,
          }}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
