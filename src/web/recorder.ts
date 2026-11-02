import { useCallback, useEffect, useRef, useState } from 'react';
import type { Prepared } from './media';

/**
 * Two minutes, and it stops itself.
 *
 * A voice note is a thing you say, not a thing you record — past a couple of
 * minutes it is a podcast nobody in a house with small children will ever
 * find time to listen to. It also bounds the upload: two minutes of opus is
 * about a megabyte.
 */
const MAX_MS = 2 * 60_000;

/**
 * What MediaRecorder is asked for, in order of preference.
 *
 * No browser supports all of these and none of them agree: Chrome and Firefox
 * give webm/opus, Safari gives mp4/aac. Asked for something it cannot do,
 * MediaRecorder throws — so the list is tried and the browser's own default is
 * the last resort.
 */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function bestType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/** Whether this browser can record at all. Safari on iOS could not until 14.3,
 * and a button that does nothing is worse than no button. */
export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

export type RecorderState =
  { kind: 'idle' } | { kind: 'asking' } | { kind: 'recording'; ms: number } | { kind: 'denied' };

/**
 * Holding down a microphone, without any of the ceremony.
 *
 * A dad with a kid on his hip cannot type a paragraph, and the thing he wanted
 * to say goes unsaid. `start` asks for the microphone the first time and
 * begins; `stop` hands back a blob ready for the same upload path a photo
 * takes; `cancel` throws it away without asking anybody.
 *
 * The track is stopped every time rather than held open, so the browser's
 * recording indicator goes off the moment he is finished. A microphone left
 * live in the background is exactly the thing people are right to mind.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>({ kind: 'idle' });
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  /** The microphone is being asked for, and there is no recorder yet. */
  const asking = useRef(false);
  /**
   * He let go, or threw it away, before the microphone answered — a hold
   * lifted at once, or the page going. When the answer comes the microphone
   * is put straight back down rather than recording into a row nobody is
   * looking at.
   */
  const abandoned = useRef(false);

  const release = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = undefined;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
  }, []);

  // A page that goes away mid-recording must not leave the microphone on.
  useEffect(
    () => () => {
      abandoned.current = true;
      release();
    },
    [release],
  );

  const start = useCallback(async () => {
    if (recorder.current !== null || asking.current) return;
    asking.current = true;
    abandoned.current = false;
    setState({ kind: 'asking' });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      if (!abandoned.current) setState({ kind: 'denied' });
      return;
    } finally {
      asking.current = false;
    }
    if (abandoned.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const mimeType = bestType();
    const rec = new MediaRecorder(stream, mimeType === undefined ? undefined : { mimeType });
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    recorder.current = rec;
    startedAt.current = Date.now();
    rec.start();

    setState({ kind: 'recording', ms: 0 });
    ticker.current = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      // It stops itself rather than recording into the void: the cap is the
      // feature, and a man who looks up at 2:01 should have his two minutes.
      // Once: a recorder that has stopped throws on a second stop.
      if (ms >= MAX_MS) {
        clearInterval(ticker.current);
        ticker.current = undefined;
        rec.stop();
        // The microphone goes OFF with it: the browser's recording light
        // stayed on until he pressed something, for a recorder that had
        // already stopped. The recorder is kept, with its two minutes, for
        // the stop or the lift that sends it; the clock stands at the cap.
        stream.getTracks().forEach((t) => t.stop());
        setState({ kind: 'recording', ms: MAX_MS });
      } else setState({ kind: 'recording', ms });
    }, 200);
  }, []);

  /** The recording so far, or null if there is nothing worth sending. */
  const stop = useCallback(async (): Promise<Prepared | null> => {
    const rec = recorder.current;
    if (rec === null) {
      // Lifted before the microphone answered: there is nothing yet, and
      // what comes is put down again.
      if (asking.current) {
        abandoned.current = true;
        setState({ kind: 'idle' });
      }
      return null;
    }

    const ms = Date.now() - startedAt.current;
    // At two minutes it has already stopped itself and will not say so
    // twice; waiting for that would be waiting for ever.
    if (rec.state !== 'inactive') {
      const finished = new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
      });
      rec.stop();
      await finished;
    }

    const type = rec.mimeType || 'audio/webm';
    const blob = new Blob(chunks.current, { type: type.split(';')[0] });
    release();
    setState({ kind: 'idle' });

    // Half a second is a misfire — a thumb that brushed the button — and
    // posting it would mean everyone plays a click.
    if (ms < 500 || blob.size === 0) return null;
    return {
      blob,
      name: `voice-${new Date().toISOString().slice(0, 19)}.${extension(type)}`,
      width: null,
      height: null,
    };
  }, [release]);

  const cancel = useCallback(() => {
    if (asking.current) abandoned.current = true;
    const rec = recorder.current;
    if (rec !== null && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
    chunks.current = [];
    release();
    setState({ kind: 'idle' });
  }, [release]);

  /** Whether the microphone is really on yet, read at the moment of asking
   * rather than at the last render. */
  const live = useCallback(() => recorder.current !== null, []);

  return { state, start, stop, cancel, live };
}

function extension(type: string): string {
  if (type.startsWith('audio/mp4')) return 'm4a';
  if (type.startsWith('audio/ogg')) return 'ogg';
  return 'webm';
}

/** "0:07" — the only number a person wants while talking. */
export function clockOf(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
