import { useEffect, useRef, useState } from 'react';

/**
 * Which build this phone is running, and what it measures at the top.
 *
 * A home-screen app is woken rather than loaded, so "is it the new one?" is a
 * real question; the commit answers it, and the two insets say what the
 * header was pushed down by (safe area, then the share of it kept clear of
 * the system's fade).
 */
export function BuildLabel() {
  const probe = useRef<HTMLSpanElement>(null);
  const [top, setTop] = useState<string | null>(null);
  useEffect(() => {
    const el = probe.current;
    if (el === null) return;
    const safe = parseFloat(getComputedStyle(el).paddingTop) || 0;
    const scrim = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    setTop(`${Math.round(safe)}/${Math.round(scrim)}`);
  }, []);
  return (
    <span
      ref={probe}
      data-testid="build"
      className="min-w-0 truncate text-sm font-normal text-muted"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'var(--scrim, 0px)',
      }}
    >
      {`${__BUILD__}${top === null ? '' : ` · ${top}`}`}
    </span>
  );
}
