import { useEffect, useState } from 'react';
import { fetchQuiet, saveQuiet, type QuietPatch, type QuietState } from './api';
import { useT } from './i18n';
import { segment, TRACK } from './Toggles';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { FIELD } from './ui/field';
import { Fold } from './ui/Fold';
import { Switch } from './ui/Switch';
import type { Snooze } from '../shared/quiet';

/** What switching quiet hours on starts from: a night's sleep. */
const DEFAULT_WINDOW = { from: '22:00', to: '07:00' };

const PAUSES: { id: Snooze; key: 'quiet.pause_1h' | 'quiet.pause_8h' | 'quiet.pause_24h' }[] = [
  { id: '1h', key: 'quiet.pause_1h' },
  { id: '8h', key: 'quiet.pause_8h' },
  { id: '24h', key: 'quiet.pause_24h' },
];

/**
 * Not tonight (2026-10-29), modelled on Google Chat: a PAUSE that lasts an
 * hour, a night or a day, and a daily window of quiet hours.
 *
 * His, across every phone he has, so it lives with the reminder switch and is
 * only offered once that switch is on: there is nothing to quiet before then.
 * A fold, because Settings has no pixel to spare — and its label says what is
 * in force, so he can tell without opening it whether he is being left alone.
 * A quiet push is dropped, never saved up: the next one comes as usual.
 */
export function Quiet() {
  const { t, lang } = useT();
  const [state, setState] = useState<QuietState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchQuiet()
      .then((s) => !cancelled && setState(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing until the server has said what is in force: a fold that claims
  // "no quiet hours" before it knows would be the room asserting a fact it has
  // not been told.
  if (state === null) return null;

  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const windowOn = state.from !== null && state.to !== null;

  async function change(patch: QuietPatch) {
    setBusy(true);
    setFailed(false);
    try {
      setState(await saveQuiet(patch));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const until = (ms: number) => {
    const at = new Date(ms);
    const sameDay = at.toDateString() === new Date().toDateString();
    return at.toLocaleString(locale, {
      ...(sameDay ? {} : { weekday: 'short' }),
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const label =
    state.snoozedUntil !== null
      ? t('quiet.paused_until', { time: until(state.snoozedUntil) })
      : windowOn
        ? t('quiet.window_label', { from: state.from ?? '', to: state.to ?? '' })
        : t('quiet.title');

  return (
    <Fold label={label} testId="quiet-open">
      <div className="grid gap-4 pb-3" data-testid="quiet">
        {state.snoozedUntil !== null ? (
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 min-w-0 text-base" data-testid="quiet-paused">
              {t('quiet.paused_until', { time: until(state.snoozedUntil) })}
            </p>
            <Button
              look="plain"
              disabled={busy}
              onClick={() => void change({ snooze: null })}
              data-testid="quiet-resume"
            >
              {t('quiet.resume')}
            </Button>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <p className="m-0 text-base text-muted">{t('quiet.pause')}</p>
            <div className={cn(TRACK, 'flex')} role="group" aria-label={t('quiet.pause')}>
              {PAUSES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  className={segment(false, 'flex-1 text-base font-semibold')}
                  onClick={() => void change({ snooze: p.id })}
                  data-testid={`quiet-pause-${p.id}`}
                >
                  {t(p.key)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <Switch
            label={t('quiet.window')}
            checked={windowOn}
            disabled={busy}
            onChange={(on) =>
              void change({
                window: on ? { ...DEFAULT_WINDOW, tz: zone() } : null,
              })
            }
            testId="quiet-window"
          />
          {windowOn ? (
            <div className="grid grid-cols-2 gap-3">
              {(['from', 'to'] as const).map((end) => (
                <div key={end} className="grid gap-1.5">
                  <label htmlFor={`quiet-${end}`} className="text-base text-muted">
                    {t(end === 'from' ? 'quiet.from' : 'quiet.to')}
                  </label>
                  <input
                    id={`quiet-${end}`}
                    type="time"
                    value={(end === 'from' ? state.from : state.to) ?? ''}
                    disabled={busy}
                    onChange={(e) => {
                      const next = e.target.value;
                      // A cleared field is mid-edit, not a window.
                      if (next === '') return;
                      const from = end === 'from' ? next : (state.from ?? DEFAULT_WINDOW.from);
                      const to = end === 'to' ? next : (state.to ?? DEFAULT_WINDOW.to);
                      void change({ window: { from, to, tz: zone() } });
                    }}
                    className={FIELD}
                    data-testid={`quiet-${end}`}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <p className="m-0 text-sm text-muted">{t('quiet.hint')}</p>
        {failed ? (
          <p className="error m-0 text-sm" role="alert">
            {t('quiet.failed')}
          </p>
        ) : null}
      </div>
    </Fold>
  );
}
