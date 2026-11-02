import { useEffect, useRef } from 'react';
import { CALL_ARTWORK } from './callAway';

/**
 * What the phone is told about the call while he is somewhere else
 * (2026-11-02, Marc asked for a call that survives a switch away).
 *
 * The Media Session is how a web page says "there is a call going on" to the
 * system: Android's Chrome turns it into the call notification with its own
 * mute and hang-up, and Chrome floats the picture by itself when he leaves
 * the app mid-call with a picture showing. iOS shows what it can. Every call
 * is guarded: a browser without any of it still has the call.
 */

/** The call's actions, which the DOM's types do not list yet. */
type CallAction = 'hangup' | 'togglemicrophone' | 'togglecamera' | 'enterpictureinpicture';

interface CallSession {
  metadata: MediaMetadata | null;
  setActionHandler(action: CallAction, handler: (() => void) | null): void;
  setMicrophoneActive?: (active: boolean) => Promise<void>;
  setCameraActive?: (active: boolean) => Promise<void>;
}

function session(): CallSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
  return navigator.mediaSession as unknown as CallSession;
}

/** A browser that does not know an action throws rather than ignoring it. */
function handle(action: CallAction, handler: (() => void) | null): void {
  try {
    session()?.setActionHandler(action, handler);
  } catch {
    // Not this browser's; the button in the app still does it.
  }
}

/** A promise from a method that may not exist, settled quietly either way. */
function quietly(promise: Promise<void> | undefined): void {
  void promise?.catch(() => {});
}

/**
 * The call, published to the system for as long as he is on it, and taken
 * back the moment he is not: a notification for a call that ended is a lie
 * the phone would go on telling.
 */
export function useCallMediaSession({
  active,
  title,
  artist,
  muted,
  camera,
  onHangUp,
  onToggleMute,
  onToggleCamera,
}: {
  active: boolean;
  title: string;
  artist: string;
  muted: boolean;
  camera: boolean;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}): void {
  // The newest of each, so a mute does not take the session down and put it
  // back just to hand the system a fresh function.
  const latest = useRef({ onHangUp, onToggleMute, onToggleCamera });
  useEffect(() => {
    latest.current = { onHangUp, onToggleMute, onToggleCamera };
  }, [onHangUp, onToggleMute, onToggleCamera]);

  useEffect(() => {
    const s = session();
    if (!active || s === null) return;
    try {
      s.metadata =
        typeof MediaMetadata === 'undefined'
          ? null
          : new MediaMetadata({ title, artist, artwork: CALL_ARTWORK });
    } catch {
      // Metadata refused; the actions still stand on their own.
    }
    handle('hangup', () => latest.current.onHangUp());
    handle('togglemicrophone', () => latest.current.onToggleMute());
    handle('togglecamera', () => latest.current.onToggleCamera());
    return () => {
      handle('hangup', null);
      handle('togglemicrophone', null);
      handle('togglecamera', null);
      try {
        s.metadata = null;
      } catch {
        // Nothing to take back.
      }
    };
  }, [active, artist, title]);

  // The system's mute and camera buttons show what is true now, not what was
  // true when the session was opened.
  useEffect(() => {
    if (active) quietly(session()?.setMicrophoneActive?.(!muted));
  }, [active, muted]);
  useEffect(() => {
    if (active) quietly(session()?.setCameraActive?.(camera));
  }, [active, camera]);
}

/** Whether this browser can float a picture over other apps at all. */
export function pipAvailable(): boolean {
  return typeof document !== 'undefined' && document.pictureInPictureEnabled === true;
}

/** Float one picture. Refused (no gesture, no frames yet) is no picture. */
export function floatPicture(video: HTMLVideoElement | null | undefined): void {
  if (video == null || !pipAvailable()) return;
  void video.requestPictureInPicture().catch(() => {});
}

/**
 * The floating picture. `pick` names the <video> to float when Chrome asks
 * (he switched away mid-call); coming back to the app puts it back, because
 * the call is on the screen in front of him again.
 */
export function usePictureInPicture(
  active: boolean,
  pick: () => HTMLVideoElement | null | undefined,
): void {
  const latest = useRef(pick);
  useEffect(() => {
    latest.current = pick;
  }, [pick]);

  useEffect(() => {
    if (!active) return;
    handle('enterpictureinpicture', () => floatPicture(latest.current()));
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (document.pictureInPictureElement == null) return;
      void document.exitPictureInPicture().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      handle('enterpictureinpicture', null);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);
}
