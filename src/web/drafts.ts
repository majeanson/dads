/**
 * The line he was halfway through, per room, on this phone.
 *
 * Marc asked (2026-11-01): a half-typed line should survive a reload, a
 * fresh build waking the app, or a look into another room and back. It is
 * his and it lives on his device; nothing is sent until he sends it.
 *
 * Pure and handed its storage, so the worker pool can typecheck and test it
 * without a DOM. Every call survives storage being absent or refusing:
 * private browsing throws on a write, and a draft that cannot be kept is
 * still a field that works.
 */

const KEY = 'dads.draft.';

export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** This device's storage, or null where even asking for it throws. */
export function deviceStorage(): DraftStore | null {
  try {
    return (globalThis as { localStorage?: DraftStore }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** What he had typed in this room, or '' when there is nothing kept. */
export function readDraft(storage: DraftStore | null, groupId: string): string {
  try {
    return storage?.getItem(KEY + groupId) ?? '';
  } catch {
    return '';
  }
}

/** Keep it, or forget it once there is nothing in it but space. */
export function writeDraft(storage: DraftStore | null, groupId: string, text: string): void {
  try {
    if (text.trim() === '') storage?.removeItem(KEY + groupId);
    else storage?.setItem(KEY + groupId, text);
  } catch {
    // Storage refused. The line is still in the field; it just will not
    // outlive a reload.
  }
}
