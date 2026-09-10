import { useEffect, useState, type FormEvent } from 'react';
import {
  countdown,
  formatNight,
  parseTime,
  phaseOf,
  WEEKDAY_NAMES,
  type DadNight,
} from '../shared/dadNight';
import { setNight as saveNight } from './api';

/** Fine enough that "any moment" is honest, coarse enough to be free. */
const TICK_MS = 15_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The standing appointment, and the countdown to it. This is the whole
 * co-presence mechanism: no push, no email — a slot everyone knows and a
 * clock that says how long until it.
 */
export function DadNightBar({ night }: { night: DadNight | null }) {
  const now = useNow();
  const [editing, setEditing] = useState(false);

  const phase = night ? phaseOf(night, now) : null;
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const elsewhere = night && night.tz !== viewerTz;

  return (
    <section className="dadnight" data-testid="dad-night">
      {phase?.kind === 'live' ? (
        <p className="dadnight-line is-live">
          <strong>Dad night.</strong> The table’s open.
        </p>
      ) : phase?.kind === 'upcoming' ? (
        <p className="dadnight-line">
          <strong>Dad night</strong> {formatNight(night!).toLowerCase()}
          {elsewhere ? ` (${night!.tz})` : ''} — {countdown(phase.startsIn)}
        </p>
      ) : null}

      {/* With no night set this line IS the whole bar: one link, not a
          sentence announcing an absence. */}
      <button type="button" className="link" onClick={() => setEditing((v) => !v)}>
        {editing ? 'Never mind' : night ? 'Change' : 'Set dad night'}
      </button>

      {editing ? <NightEditor night={night} onDone={() => setEditing(false)} /> : null}
    </section>
  );
}

function NightEditor({ night, onDone }: { night: DadNight | null; onDone: () => void }) {
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
