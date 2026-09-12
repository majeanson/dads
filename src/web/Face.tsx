import { faceUrl } from './api';
import { initials } from './initials';
import { cn } from './ui/cn';

/**
 * A dad, at a glance.
 *
 * His picture when he has set one, and his initials when he has not — never
 * an empty grey circle, because the whole point is telling five men apart and
 * a blank is worse at that than two letters. The letters come from the name,
 * so a dad who never sets a face still gets something that is his.
 *
 * Decorative by default: wherever this appears the name is already beside it,
 * and a screen reader announcing "Marc, photo of Marc, Marc" is worse than
 * silence.
 */
export function Face({
  memberId,
  name,
  version,
  size = 28,
  className,
}: {
  memberId: string;
  name: string;
  version: number | undefined;
  size?: number;
  className?: string;
}) {
  const src = faceUrl(memberId, version);
  const box = { width: size, height: size } as const;

  return src === null ? (
    <span
      aria-hidden="true"
      style={{ ...box, fontSize: Math.round(size * 0.4) }}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full',
        'bg-panel font-semibold text-muted uppercase',
        className,
      )}
    >
      {initials(name)}
    </span>
  ) : (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={box}
      className={cn('inline-block shrink-0 rounded-full object-cover', className)}
    />
  );
}
