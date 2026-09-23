import type { LucideIcon } from 'lucide-react';
import { Logo } from './Logo';

/**
 * The dad, holding something: the app's face with a prop badged on it, one
 * per screen — a question for the questions, a mug for the week, a calendar
 * for the night. It is what turns the mark into a character, and what tells
 * a man which room he walked into before he reads the title beside it.
 * Decorative: the title is the name.
 */
export function Pose({ prop: Prop, size = 30 }: { prop: LucideIcon; size?: number }) {
  const badge = Math.round(size * 0.55);
  return (
    <span
      aria-hidden="true"
      className="motion-pop relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      <Logo size={size} hole="var(--bg)" motion="on" className="text-accent" />
      <span
        className="absolute -right-1.5 -bottom-1 grid place-items-center rounded-full bg-accent text-on-accent"
        style={{ width: badge, height: badge, boxShadow: '0 0 0 2px var(--bg)' }}
      >
        <Prop size={Math.round(badge * 0.62)} strokeWidth={2.5} />
      </span>
    </span>
  );
}
