import { LogIn, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPresence, type PresenceEvent } from './api';
import { useT } from './i18n';

/** Long enough to be free, short enough that a leave lands while you look. */
const REFRESH_MS = 5_000;

function when(ts: number, locale: string): string {
  const day = new Date(ts);
  const today = new Date();
  const sameDay = day.toDateString() === today.toDateString();
  const time = day.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return sameDay
    ? time
    : `${day.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time}`;
}

/**
 * Who is here, and who has been.
 *
 * Coming and going used to be a line in the conversation, which meant that in
 * a group of five on phones the room mostly talked about itself. It is not
 * nothing, though — knowing your mate looked in at eleven and you missed him
 * is worth something — so it lives here, behind the count in the header, where
 * you find it by asking rather than by scrolling past it.
 */
export function Here({ roster }: { roster: { memberId: string; name: string; you: boolean }[] }) {
  const { t, lang } = useT();
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const [events, setEvents] = useState<PresenceEvent[] | null | 'loading'>('loading');

  // Read again while it is open, because this is the one view whose whole
  // subject is people arriving and going. A dad leaves the room the moment his
  // socket does, but the row saying so is written when the 15-second grace
  // runs out — so a list fetched once is a list that misses the leave you were
  // watching for.
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      fetchPresence()
        .then((e) => !cancelled && setEvents(e))
        .catch(() => !cancelled && setEvents((prev) => (prev === 'loading' ? null : prev)));

    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div data-testid="here">
      {roster.length === 0 ? (
        <p className="text-muted">{t('here.nobody')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t('here.title')}>
          {roster.map((m) => (
            <li
              key={m.memberId}
              data-testid="roster-entry"
              className="rounded-full border border-line bg-panel px-3 py-1 text-sm"
            >
              {/* A dot, not a word: the list is of people who are here. */}
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
              {m.name}
              {m.you ? t('here.you') : ''}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-6 mb-2 text-sm font-semibold text-muted">{t('here.comings')}</h2>
      {events === 'loading' ? (
        <p className="text-muted">…</p>
      ) : events === null ? (
        <p className="text-muted">{t('here.failed')}</p>
      ) : events.length === 0 ? (
        <p className="text-muted">{t('here.nothing')}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {events.map((e) => (
            <li
              key={`${e.at}-${e.name}-${e.kind}`}
              data-testid="coming"
              className="flex items-center gap-2.5 border-b border-line py-2 text-[0.9375rem] last:border-0"
            >
              {e.kind === 'in' ? (
                <LogIn size={15} aria-hidden="true" className="shrink-0 text-accent" />
              ) : (
                <LogOut size={15} aria-hidden="true" className="shrink-0 text-muted" />
              )}
              <span className="flex-1">
                {t(e.kind === 'in' ? 'here.came_in' : 'here.left', { name: e.name })}
              </span>
              <time className="text-xs text-muted tabular-nums">{when(e.at, locale)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
