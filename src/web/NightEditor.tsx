import { useState, type FormEvent } from 'react';
import {
  countdown,
  formatNight,
  parseTime,
  phaseOf,
  WEEKDAY_NAMES,
  type DadNight,
} from '../shared/dadNight';
import { setNight as saveNight } from './api';

/** Inside this, the night is close enough to belong on the room's header. */
const SOON_MS = 24 * 60 * 60 * 1000;

/**
 * The standing appointment, in as few words as it can be said.
 *
 * Two readings of the same thing: `nightSoon` is what the room shows, and only
 * when it is nearly time — the rest of the week that line would be furniture.
 * `nightItem` is the menu's, where a dad has gone looking for it and the full
 * answer is what he wants.
 */
export function nightSoon(night: DadNight | null, now: number): string | null {
  const phase = night ? phaseOf(night, now) : null;
  if (phase?.kind === 'live') return 'dad night — the table’s open';
  if (phase?.kind === 'upcoming' && phase.startsIn <= SOON_MS) {
    return `dad night ${countdown(phase.startsIn)}`;
  }
  return null;
}

export function nightItem(night: DadNight | null, now: number): string {
  if (night === null) return 'Set dad night';
  const phase = phaseOf(night, now);
  const when = formatNight(night).toLowerCase();
  if (phase?.kind === 'live') return `Dad night ${when} — the table’s open`;
  if (phase?.kind === 'upcoming') return `Dad night ${when} — ${countdown(phase.startsIn)}`;
  return `Dad night ${when}`;
}

/**
 * Setting it. Any dad can — there is no admin here — and the change is
 * announced in the room by name, which is the whole social mechanism.
 */
export function NightEditor({ night, onDone }: { night: DadNight | null; onDone: () => void }) {
  const [weekday, setWeekday] = useState(String(night?.weekday ?? 4));
  const [time, setTime] = useState(night?.time ?? '21:00');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parseTime(time)) {
      setError('Time needs to look like 21:00.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveNight({
        weekday: Number(weekday),
        time,
        // The group's zone is the group's, not whoever happens to be editing
        // from a hotel in another country — and when no night has ever been
        // set there is no group zone here to send, so send none and let the
        // server keep the one it already holds. dad_night_tz is not just the
        // night's clock: the ISO week and the daily prompt rollover are both
        // derived from it, so a dad on a business trip could otherwise move
        // the whole group's calendar.
        tz: night?.tz ?? null,
      });
      onDone();
    } catch {
      setError('Couldn’t save that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await saveNight(null);
      onDone();
    } catch {
      setError('Couldn’t save that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="night-editor" onSubmit={submit}>
      <label htmlFor="night-weekday" className="sr-only">
        Day
      </label>
      <select
        id="night-weekday"
        value={weekday}
        onChange={(e) => setWeekday(e.target.value)}
        aria-label="Day"
      >
        {WEEKDAY_NAMES.map((name, index) => (
          <option key={name} value={index}>
            {name}s
          </option>
        ))}
      </select>

      <label htmlFor="night-time" className="sr-only">
        Time
      </label>
      <input
        id="night-time"
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        aria-label="Time"
        required
      />

      <button type="submit" disabled={busy}>
        Save
      </button>
      {night ? (
        <button type="button" className="link" onClick={() => void clear()} disabled={busy}>
          Clear
        </button>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
