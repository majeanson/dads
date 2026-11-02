import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { deviceStorage } from './drafts';
import { useT } from './i18n';
import { Button } from './ui/Button';
import { nextRate, readRate, writeRate, type Rate } from './voiceRate';

/**
 * The speed is the PHONE's, not one note's (Marc asked, 2026-11-02): every
 * player on the screen follows a change made on any of them. The value
 * lives in storage; this is only who to tell.
 */
const rateListeners = new Set<() => void>();
function onRate(listener: () => void) {
  rateListeners.add(listener);
  return () => void rateListeners.delete(listener);
}
const currentRate = () => readRate(deviceStorage());
// Storage that refuses would leave every player at 1× after a press, so
// the last choice is also held here for this page.
let chosen: Rate | null = null;
function useRate(): [Rate, () => void] {
  const kept = useSyncExternalStore(onRate, () => chosen ?? currentRate());
  return [
    kept,
    () => {
      chosen = nextRate(kept);
      writeRate(deviceStorage(), chosen);
      rateListeners.forEach((l) => l());
    },
  ];
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A voice note, played by the app rather than by the browser.
 *
 * The browser's own player kept every touch to itself: a long press on it
 * never reached the line, so a voice note was the one thing in the
 * conversation a dad could not answer, mark or take back from a phone. This
 * one is ours — a play button, a bar that shows where it is and jumps where he
 * taps, the time — so a tap plays and a long press is the line's menu, like
 * every other line.
 */
export function VoiceNote({ src }: { src: string }) {
  const { t, lang } = useT();
  const audio = useRef<HTMLAudioElement>(null);
  const [rate, faster] = useRate();
  // Both: loading a source puts `playbackRate` back to the default.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
  }, [rate]);
  /** "1.5×", and "1,5×" in French. */
  const shown = `${rate.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}×`;
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(Number.NaN);
  /**
   * Chrome reports a note it recorded itself as endless. A MediaRecorder
   * webm carries no duration in its header, so `loadedmetadata` says
   * Infinity and stays that way until the whole thing has played once — no
   * length beside it, a bar that never fills, a tap on it that goes nowhere.
   * Seeking past the end is the one thing that makes the browser find out:
   * it scans to the last frame, fires `durationchange` with the real number,
   * and the note is put back to the start before anybody hears it.
   */
  const probing = useRef(false);
  function learned(el: HTMLAudioElement) {
    if (Number.isFinite(el.duration)) {
      setLength(el.duration);
      if (probing.current) {
        probing.current = false;
        el.currentTime = 0;
      }
    } else if (el.duration === Number.POSITIVE_INFINITY && !probing.current) {
      probing.current = true;
      el.currentTime = 1e101;
    }
  }

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }

  function jump(event: MouseEvent<HTMLSpanElement>) {
    const el = audio.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const box = event.currentTarget.getBoundingClientRect();
    el.currentTime = ((event.clientX - box.left) / box.width) * el.duration;
  }

  const done = Number.isFinite(length) && length > 0 ? Math.min(at / length, 1) : 0;

  return (
    <span
      className="mt-1.5 flex w-full max-w-80 items-center gap-2.5 rounded-full border border-line bg-panel py-1 pr-2 pl-1"
      data-testid="voice-note"
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('voice.pause') : t('voice.play')}
        className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-on-accent transition-[scale] duration-100 active:scale-90"
      >
        {playing ? (
          <Pause size={18} aria-hidden="true" fill="currentColor" />
        ) : (
          <Play size={18} aria-hidden="true" fill="currentColor" className="translate-x-px" />
        )}
      </button>
      {/* Where it is, and a place to jump to. A tap, not a drag: a drag across
          a line on a phone is a scroll. */}
      <span
        className="relative h-1.5 min-w-0 flex-1 cursor-pointer rounded-full bg-edge/40"
        // A click, not a pointer-up: the lift at the end of a long press is
        // swallowed by the line as a click, and must not also move the note.
        onClick={jump}
        aria-hidden="true"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${done * 100}%` }}
        />
      </span>
      <span className="shrink-0 text-xs text-muted tabular-nums" data-testid="voice-clock">
        {clock(playing || at > 0 ? at : length)}
      </span>
      {/* 1×, 1.5×, 2×, and round: the speed this phone plays every note at.
          Small, inside the conversation, and its name says the speed. */}
      <Button
        look="quiet"
        size="iconSm"
        className="w-auto min-w-9 shrink-0 px-1 text-xs tabular-nums"
        aria-label={t('voice.speed', { rate: shown })}
        onClick={faster}
        data-testid="voice-speed"
      >
        {shown}
      </Button>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = rate;
          learned(e.currentTarget);
        }}
        onDurationChange={(e) => learned(e.currentTarget)}
        onTimeUpdate={(e) => {
          if (!probing.current) setAt(e.currentTarget.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
      />
    </span>
  );
}
