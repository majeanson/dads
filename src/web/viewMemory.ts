/**
 * Which side of the room he was on, per device.
 *
 * The app opens on home, and that stays true for a dad who has not been here
 * in a while. But one who closed the app in the middle of the conversation —
 * the phone locked, the app swiped away, a reload — comes back to the
 * conversation, not to a screen asking whether he is coming for the third
 * time. "A while" is `FRESH_MS` since he last had it open; past that, home.
 *
 * Per group, beside the seen mark. Reached through a locally-typed accessor
 * for the same reason `seen.ts` is: the pure logic is typechecked in the worker
 * pool, and every call has to survive storage being absent or refusing.
 */

const KEY = 'dads.view.';

/** Long enough for an evening; short enough that tomorrow starts on home. */
export const FRESH_MS = 12 * 60 * 60 * 1000;

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function store(): Store | null {
  return (globalThis as { localStorage?: Store }).localStorage ?? null;
}

export type View = 'home' | 'talk';

/** Where he was, or 'home' when there is nothing recent to go by. */
export function lastView(groupId: string, now = Date.now()): View {
  try {
    const raw = store()?.getItem(KEY + groupId) ?? null;
    if (raw === null) return 'home';
    const [view, at] = raw.split('@');
    const when = Number(at);
    return view === 'talk' && Number.isFinite(when) && now - when < FRESH_MS ? 'talk' : 'home';
  } catch {
    return 'home';
  }
}

export function rememberView(groupId: string, view: View, now = Date.now()): void {
  try {
    store()?.setItem(KEY + groupId, `${view}@${now}`);
  } catch {
    // Storage refused. He opens on home next time; the room works.
  }
}
