import { Check, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { countdownParts, parseTime, phaseOf, weekdayOf, type DadNight } from '../shared/dadNight';
import { setNight as saveNight } from './api';
import { nightWhen, plural, useT, weekdayNames, type Lang, type T } from './i18n';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { FIELD } from './ui/field';

/** Inside this, the night is close enough to belong on the room's header. */
const SOON_MS = 24 * 60 * 60 * 1000;

/** "in 2 hours" / "dans 2 heures", from the parts the shared clock gives us. */
function countdownIn(t: T, lang: Lang, ms: number): string {
  const { unit, n } = countdownParts(ms);
  if (unit === 'now') return t('n.countdown_now');
  return t(`n.countdown_${unit}_${plural(lang, n)}`, { n });
}

/**
 * How far off it is, and nothing about which day — home says the day and the
 * hour in type four times this size, directly above.
 *
 * Null for a night that is set but not close enough to count down to, which
 * on home is most of the week: "in 5 days" under "Thursday 21:00" is the
 * screen saying the same thing twice in a smaller voice.
 */
export function nightAway(t: T, lang: Lang, night: DadNight, now: number): string | null {
  const phase = phaseOf(night, now);
  if (phase?.kind === 'live') return t('n.soon_live');
  if (phase?.kind === 'upcoming' && phase.startsIn <= AWAY_MS) {
    return countdownIn(t, lang, phase.startsIn);
  }
  return null;
}

/** Far enough out that a countdown stops being news. Three days: inside that
 * a man still has the evening to arrange around. */
const AWAY_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The standing appointment, in as few words as it can be said.
 *
 * Two readings of the same thing: `nightSoon` is what the room shows, and only
 * when it is nearly time — the rest of the week that line would be furniture.
 * `nightItem` is the menu's, where a dad has gone looking for it and the full
 * answer is what he wants.
 */
export function nightSoon(t: T, lang: Lang, night: DadNight | null, now: number): string | null {
  if (night === null) return null;
  const phase = phaseOf(night, now);
  if (phase?.kind === 'live') return t('n.soon_live');
  // Close enough to be a countdown; otherwise the day and the time, because a
  // standing appointment is there to answer "when is it again" without anybody
  // having to go and look.
  if (phase?.kind === 'upcoming' && phase.startsIn <= SOON_MS) {
    return t('n.soon', { countdown: countdownIn(t, lang, phase.startsIn) });
  }
  return t('n.header', { when: nightWhen(lang, night) });
}

export function nightItem(t: T, lang: Lang, night: DadNight | null, now: number): string {
  if (night === null) return t('n.set');
  const phase = phaseOf(night, now);
  if (phase?.kind === 'live') return t('n.item_live');
  if (phase?.kind === 'upcoming') {
    return t('n.item', { countdown: countdownIn(t, lang, phase.startsIn) });
  }
  return t('n.item_plain', { when: nightWhen(lang, night) });
}

/**
 * The sheet's own line: the day and the hour, and how far off it is.
 *
 * It does NOT say "dad night" — the sheet it sits in is titled that, and a
 * heading followed by itself is the panel stuttering.
 */
export function nightDetail(t: T, lang: Lang, night: DadNight, now: number): string {
  const phase = phaseOf(night, now);
  const when = nightWhen(lang, night);
  if (phase?.kind === 'live') return t('n.detail_live', { when });
  if (phase?.kind === 'upcoming') {
    return t('n.detail', { when, countdown: countdownIn(t, lang, phase.startsIn) });
  }
  return when;
}

/**
 * Setting it. Any dad can — there is no admin here — and the change is
 * announced in the room by name, which is the whole social mechanism.
 */
export function NightEditor({ night, onDone }: { night: DadNight | null; onDone: () => void }) {
  const { t, lang } = useT();
  const [weekday, setWeekday] = useState(String(night?.weekday ?? 4));
  const [time, setTime] = useState(night?.time ?? '21:00');
  /**
   * A night with a date is edited AS a date.
   *
   * The weekday dropdown is the right control for a standing night and the
   * wrong one for an arranged evening: it cannot say "the 25th", so saving
   * from it turned Thursday-the-25th into every-Thursday and the group lost
   * the one thing they had agreed. An evening that was arranged for a date
   * stays an evening arranged for a date, and this moves it.
   */
  const [date, setDate] = useState(night?.date ?? '');
  const arranged = date !== '';
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
        // Ignored by the server when a date is sent — it derives the weekday
        // from the date rather than believing two fields that can disagree —
        // but the shape wants a number either way.
        weekday: arranged ? (weekdayOf(date) ?? 0) : Number(weekday),
        time,
        ...(arranged ? { date } : {}),
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
    <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
      {arranged ? (
        <>
          <label htmlFor="night-date" className="sr-only">
            {t('n.date')}
          </label>
          <input
            id="night-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label={t('n.date')}
            required
            className={cn(FIELD, 'h-13 w-auto py-0')}
            data-testid="night-date"
          />
        </>
      ) : (
        <>
          <label htmlFor="night-weekday" className="sr-only">
            {t('n.day')}
          </label>
          <select
            id="night-weekday"
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
            aria-label={t('n.day')}
            className={cn(FIELD, 'h-13 w-auto py-0')}
          >
            {weekdayNames(lang).map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </>
      )}

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
        className={cn(FIELD, 'h-13 w-auto py-0')}
      />

      <Button type="submit" look="primary" size="lg" disabled={busy}>
        <Check size={18} aria-hidden="true" />
        {t('n.save')}
      </Button>
      {night ? (
        <Button look="danger" size="lg" onClick={() => void clear()} disabled={busy}>
          <Trash2 size={18} aria-hidden="true" />
          {t('n.clear')}
        </Button>
      ) : null}

      {error ? (
        <p className="error w-full" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
