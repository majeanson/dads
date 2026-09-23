import { MARKS, REACTIONS } from '../shared/protocol';

/**
 * The six marks a dad sees first, learnt from the ones he uses.
 *
 * They start as the defaults. Every mark he puts on a line is counted, with
 * the count fading by half every week, so what he has reached for lately
 * rises and what he stopped using sinks — a phone keyboard's "frequently
 * used", and for the same reason. The defaults hold their places, in their
 * order, until something he uses more pushes one out from the END; a row
 * that reshuffled on every tap would be a row his thumb could never learn.
 *
 * Per device, like the theme: it is about his hands, not about the group.
 * Pure over the tally so the worker pool can test it; the storage is below.
 */
export type Tally = Record<string, { n: number; at: number }>;

const WEEK = 7 * 24 * 60 * 60 * 1000;

function score(tally: Tally, emoji: string, now: number): number {
  const t = tally[emoji];
  return t ? t.n * 0.5 ** ((now - t.at) / WEEK) : 0;
}

export function sixFor(tally: Tally, now: number): string[] {
  const used = (MARKS as readonly string[])
    .filter((e) => score(tally, e, now) > 0)
    .sort((a, b) => score(tally, b, now) - score(tally, a, now));
  const defaults = REACTIONS as readonly string[];
  // His favourites that are not defaults, most used first...
  const extra = used.filter((e) => !defaults.includes(e));
  // ...and the defaults he uses least give up their places, from the end.
  const keep = [...defaults]
    .sort((a, b) => {
      const d = score(tally, b, now) - score(tally, a, now);
      return d !== 0 ? d : defaults.indexOf(a) - defaults.indexOf(b);
    })
    .slice(0, Math.max(0, 6 - extra.length));
  const kept = defaults.filter((e) => keep.includes(e));
  return [...kept, ...extra].slice(0, 6);
}

export function counted(tally: Tally, emoji: string, now: number): Tally {
  return { ...tally, [emoji]: { n: score(tally, emoji, now) + 1, at: now } };
}

const KEY = 'dads.marks';

/** Reached through a locally-typed accessor, like seen.ts, so the worker pool
 * can import this file without a DOM. */
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function store(): Store | null {
  return (globalThis as { localStorage?: Store }).localStorage ?? null;
}

/** Storage can refuse — a private window, a full disk — and the defaults are
 * always a fine answer. */
export function readTally(): Tally {
  try {
    return (JSON.parse(store()?.getItem(KEY) ?? '{}') as Tally) ?? {};
  } catch {
    return {};
  }
}

export function noteMark(emoji: string): void {
  try {
    store()?.setItem(KEY, JSON.stringify(counted(readTally(), emoji, Date.now())));
  } catch {
    // Not remembered; the row simply does not learn this one.
  }
}
