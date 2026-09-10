import { useState, type FormEvent } from 'react';
import { countdownParts, parseTime, phaseOf, type DadNight } from '../shared/dadNight';
import { setNight as saveNight } from './api';
import { nightWhen, plural, useT, weekdayNames, type Lang, type T } from './i18n';

/** Inside this, the night is close enough to belong on the room's header. */
const SOON_MS = 24 * 60 * 60 * 1000;

/** "in 2 hours" / "dans 2 heures", from the parts the shared clock gives us. */
function countdownIn(t: T, lang: Lang, ms: number): string {
  const { unit, n } = countdownParts(ms);
  if (unit === 'now') return t('n.countdown_now');
  return t(`n.countdown_${unit}_${plural(lang, n)}`, { n });
}

/**
 * The standing appointment, in as few words as it can be said.
 *
 * Two readings of the same thing: `nightSoon` is what the room shows, and only
 * when it is nearly time — the rest of the week that line would be furniture.
 * `nightItem` is the menu's, where a dad has gone looking for it and the full
 * answer is what he wants.
 */
export function nightSoon(t: T, lang: Lang, night: DadNight | null, now: number): string | null {
  const phase = night ? phaseOf(night, now) : null;
  if (phase?.kind === 'live') return t('n.soon_live');
  if (phase?.kind === 'upcoming' && phase.startsIn <= SOON_MS) {
    return t('n.soon', { countdown: countdownIn(t, lang, phase.startsIn) });
  }
  return null;
}

export function nightItem(t: T, lang: Lang, night: DadNight | null, now: number): string {
  if (night === null) return t('n.set');
  const phase = phaseOf(night, now);
  const when = nightWhen(lang, night);
  if (phase?.kind === 'live') return t('n.item_live', { when });
  if (phase?.kind === 'upcoming') {
    return t('n.item', { when, countdown: countdownIn(t, lang, phase.startsIn) });
  }
  return t('n.item_plain', { when });
}

/**
 * Setting it. Any dad can — there is no admin here — and the change is
 * announced in the room by name, which is the whole social mechanism.
 */
export function NightEditor({ night, onDone }: { night: DadNight | null; onDone: () => void }) {
  const { t, lang } = useT();
  const [weekday, setWeekday] = useState(String(night?.weekday ?? 4));
  const [time, setTime] = useState(night?.time ?? '21:00');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parseTime(time)) {
      setError(t('n.bad_time'));
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
      setError(t('n.save_failed'));
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
      setError(t('n.save_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="night-editor" onSubmit={submit}>
      <label htmlFor="night-weekday" className="sr-only">
        {t('n.day')}
      </label>
      <select
        id="night-weekday"
        value={weekday}
        onChange={(e) => setWeekday(e.target.value)}
        aria-label={t('n.day')}
      >
        {weekdayNames(lang).map((name, index) => (
          <option key={name} value={index}>
            {name}
          </option>
        ))}
      </select>

      <label htmlFor="night-time" className="sr-only">
        {t('n.time')}
      </label>
      <input
        id="night-time"
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        aria-label={t('n.time')}
        required
      />

      <button type="submit" disabled={busy}>
        {t('n.save')}
      </button>
      {night ? (
        <button type="button" className="link" onClick={() => void clear()} disabled={busy}>
          {t('n.clear')}
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
