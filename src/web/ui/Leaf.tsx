import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

/**
 * A screen inside a sheet, one step down from the list that opened it: the
 * way back first, then its own heading, then what it holds.
 *
 * The shape `Here` gives a profile, made once so the leaves of Settings
 * (2026-11-02) agree with each other. The way back takes the focus when the
 * leaf opens: the row that was pressed is gone from the page, and a focus
 * left on nothing starts a keyboard or a screen reader from the top of the
 * document.
 */
export function Leaf({
  back,
  onBack,
  title,
  testId,
  children,
}: {
  /** The word on the way back: the name of the list it returns to. */
  back: string;
  onBack: () => void;
  title: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  const leaf = useRef<HTMLDivElement>(null);
  useEffect(() => {
    leaf.current
      ?.querySelector<HTMLElement>('[data-testid="leaf-back"]')
      ?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={leaf} className="grid grid-cols-1 gap-3" data-testid={testId}>
      <Button
        look="quiet"
        className="-ml-1 justify-self-start px-1"
        onClick={onBack}
        data-testid="leaf-back"
      >
        <ChevronLeft size={20} aria-hidden="true" />
        {back}
      </Button>
      <h2 className="display m-0 min-w-0 truncate text-2xl text-ink">{title}</h2>
      {children}
    </div>
  );
}
