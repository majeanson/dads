import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * One row that opens onto the rest.
 *
 * The children are mounted only while it is open, so what is behind it costs
 * the sheet nothing until a dad asks — the same rule as the creator's forms
 * in Settings.
 */
export function Fold({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 border-b border-line py-2 text-left text-[1.0625rem] text-ink"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          size={20}
          aria-hidden="true"
          className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? <div className="pt-2">{children}</div> : null}
    </div>
  );
}
