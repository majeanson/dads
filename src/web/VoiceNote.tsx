import { Pause, Play } from 'lucide-react';
import { useRef, useState, type MouseEvent } from 'react';
import { useT } from './i18n';

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
  const { t } = useT();
  const audio = useRef<HTMLAudioElement>(null);
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
      className="mt-1.5 flex w-full max-w-80 items-center gap-2.5 rounded-full border border-line bg-panel py-1 pr-3.5 pl-1"
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
      <span className="shrink-0 text-xs text-muted tabular-nums">
        {clock(playing || at > 0 ? at : length)}
      </span>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => learned(e.currentTarget)}
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
