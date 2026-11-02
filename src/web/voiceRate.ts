/**
 * How fast this phone plays voice notes (Marc asked, 2026-11-02): 1×, then
 * 1.5×, then 2×, then back. Remembered per device, like the draft: a man
 * who listens at double speed listens to every note that way.
 *
 * Pure and handed its storage, so the worker pool can test it. Every call
 * survives storage being absent or refusing.
 */
import type { DraftStore } from './drafts';

export const RATES = [1, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];

const KEY = 'dads.voice.rate';

/** The speed kept on this device, or 1 when there is none (or nonsense). */
export function readRate(storage: DraftStore | null): Rate {
  try {
    const kept = Number(storage?.getItem(KEY));
    return RATES.find((r) => r === kept) ?? 1;
  } catch {
    return 1;
  }
}

/** The speed after this one, round again after the fastest. */
export function nextRate(rate: Rate): Rate {
  return RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
}

/** Keep it on this device; 1 is the default and is kept as nothing. */
export function writeRate(storage: DraftStore | null, rate: Rate): void {
  try {
    if (rate === 1) storage?.removeItem(KEY);
    else storage?.setItem(KEY, String(rate));
  } catch {
    // Not kept, still played at that speed.
  }
}
