/**
 * The two little sounds of a call: somebody sat down, somebody got up.
 *
 * Synthesised, so there is no file to ship or cache. Joining rises, leaving
 * falls. Only ever played while this dad is on the call himself, which means he
 * has already tapped something and the browser lets the context run.
 */

let context: AudioContext | null = null;

function blip(from: number, to: number): void {
  try {
    context ??= new AudioContext();
    const ctx = context;
    void ctx.resume().catch(() => {});

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + 0.12);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch {
    // No Web Audio. The tile appearing is still the news.
  }
}

export const joinedSound = () => blip(520, 880);
export const leftSound = () => blip(660, 330);
