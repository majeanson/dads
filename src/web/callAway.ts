import { translator, type Lang } from '../shared/dictionary';

/**
 * The call while he is somewhere else: the decisions, with nothing of the
 * browser in them, so the worker pool can test them (2026-11-02, Marc asked
 * for a call that survives a switch away). The wiring that acts on them is in
 * `useCall.ts` (links, the return, the room) and `mediaSession.ts` (what the
 * phone is told, the floating picture).
 */

/** A link that has said `disconnected` for this long by the time he comes
 * back is not going to come back by itself. Counted from when it was first
 * seen so, not from the return. */
export const DOWN_GRACE_MS = 10_000;

/** How long after coming back the links get to answer before the call row
 * says it dropped. Long enough for an ICE restart to land on a phone. */
export const RETURN_GRACE_MS = 8_000;

/** What he is called among the tiles and the speaking marks: not a member
 * id, so it can never collide with one. Never sent out. */
export const YOU = 'you';

/** What the phone shows beside the call: its notification on Android, the
 * lock screen's media card where there is one. */
export const CALL_ARTWORK = [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }];

export function callSessionText(lang: Lang, roomName: string): { title: string; artist: string } {
  return { title: roomName, artist: translator(lang)('call.on_call') };
}

/** One picture on the call, as far as choosing what floats is concerned. */
export interface PipTile {
  memberId: string;
  /** Sending pictures right now. */
  hasVideo: boolean;
  speaking: boolean;
}

/**
 * Which picture goes with him into a floating window when he leaves the app:
 * the one he enlarged, else whoever is talking, else the first one showing.
 * Never his own preview — he knows what he looks like — and nothing at all
 * when nobody is showing a picture: then the call is sound, and the phone's
 * call notification is what keeps it findable.
 */
export function pickPip(tiles: readonly PipTile[], enlarged: string | null): string | null {
  const showing = tiles.filter((t) => t.hasVideo && t.memberId !== YOU);
  return (
    showing.find((t) => t.memberId === enlarged)?.memberId ??
    showing.find((t) => t.speaking)?.memberId ??
    showing[0]?.memberId ??
    null
  );
}

/** `RTCPeerConnectionState`, spelled out: this module has no DOM types. */
export type LinkState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

/**
 * What to do with one link when he comes back. `failed` is restarted at once,
 * as it always was. `disconnected` often heals by itself, so it is restarted
 * only once it has been down past the grace. `closed` is a dad gone: the link
 * is dropped and his tile with it, the way a leaving dad's is.
 */
export function linkVerdict(
  state: LinkState,
  downSince: number | null,
  now: number,
): 'keep' | 'restart' | 'gone' {
  if (state === 'closed') return 'gone';
  if (state === 'failed') return 'restart';
  if (state === 'disconnected' && downSince !== null && now - downSince >= DOWN_GRACE_MS) {
    return 'restart';
  }
  return 'keep';
}

/**
 * Whether, a grace after coming back, the call is a call in name only: the
 * room no longer counts him on it, or there are others on it and not one link
 * to any of them is up. Alone on the call is not dropped — "just you so far"
 * is the truth then.
 */
export function callDropped({
  onRoster,
  others,
  connected,
}: {
  onRoster: boolean;
  others: number;
  connected: number;
}): boolean {
  return !onRoster || (others > 0 && connected === 0);
}
