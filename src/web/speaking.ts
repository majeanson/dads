/**
 * Who is talking.
 *
 * On a five-way call with the cameras off, sound alone tells you that somebody
 * said something and not which of them it was. This watches each stream's own
 * level and says who is above it — nothing is sent over the wire, nothing is
 * recorded, and the analysis is entirely local to each browser.
 *
 * One AudioContext for the whole call, one analyser per stream, and a single
 * timer polling all of them: an interval per peer would be four timers on a
 * phone doing something that costs nothing done once.
 */

/** Above this, on a 0–1 scale of RMS, a man is talking rather than breathing. */
const SPEAKING = 0.045;

/** How long a voice keeps the mark after it stops, so it does not flicker
 * between syllables. */
const HOLD_MS = 600;

/** Slow enough to be free on a phone, fast enough to feel immediate. */
const POLL_MS = 120;

interface Watched {
  analyser: AnalyserNode;
  /** Typed on its backing buffer because the DOM's own signature is: a
   * Float32Array over a SharedArrayBuffer is not what getFloatTimeDomainData
   * will take. */
  samples: Float32Array<ArrayBuffer>;
  loudUntil: number;
}

export class SpeakingWatch {
  private context: AudioContext | null = null;
  private readonly watched = new Map<string, Watched>();
  private readonly sources = new Map<string, MediaStreamAudioSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onChange: (speaking: string[]) => void) {}

  /** Start watching a stream, or replace the one already under that id. */
  watch(id: string, stream: MediaStream): void {
    if (stream.getAudioTracks().length === 0) return;
    this.drop(id);

    try {
      this.context ??= new AudioContext();
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 512;
      // A tiny bit of smoothing so a consonant does not read as silence.
      analyser.smoothingTimeConstant = 0.6;
      const source = this.context.createMediaStreamSource(stream);
      source.connect(analyser);

      this.sources.set(id, source);
      this.watched.set(id, {
        analyser,
        samples: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
        loudUntil: 0,
      });
      this.start();
    } catch {
      // No Web Audio, or a stream it will not take. The call is unaffected;
      // nobody gets a ring.
    }
  }

  drop(id: string): void {
    this.sources.get(id)?.disconnect();
    this.sources.delete(id);
    this.watched.delete(id);
    if (this.watched.size === 0) this.stop();
  }

  /** End of the call: every analyser, the timer and the context itself. */
  close(): void {
    for (const id of [...this.watched.keys()]) this.drop(id);
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  private start(): void {
    this.timer ??= setInterval(() => this.tick(), POLL_MS);
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.onChange([]);
  }

  private tick(): void {
    const now = Date.now();
    const loud: string[] = [];

    for (const [id, w] of this.watched) {
      w.analyser.getFloatTimeDomainData(w.samples);
      let sum = 0;
      for (const sample of w.samples) sum += sample * sample;
      const rms = Math.sqrt(sum / w.samples.length);

      if (rms > SPEAKING) w.loudUntil = now + HOLD_MS;
      if (w.loudUntil > now) loud.push(id);
    }

    this.onChange(loud);
  }
}
