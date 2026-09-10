import { useEffect, useState } from 'react';
import { fetchPresence, type PresenceEvent } from './api';
import { useT } from './i18n';

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

  useEffect(() => {
    let cancelled = false;
    fetchPresence()
      .then((e) => !cancelled && setEvents(e))
      .catch(() => !cancelled && setEvents(null));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="here" data-testid="here">
      {roster.length === 0 ? (
        <p className="quiet">{t('here.nobody')}</p>
      ) : (
        <ul className="menu-roster" aria-label={t('here.title')}>
          {roster.map((m) => (
            <li key={m.memberId} data-testid="roster-entry">
              {m.name}
              {m.you ? t('here.you') : ''}
            </li>
          ))}
        </ul>
      )}

      <h2>{t('here.comings')}</h2>
      {events === 'loading' ? (
        <p className="quiet">…</p>
      ) : events === null ? (
        <p className="quiet">{t('here.failed')}</p>
      ) : events.length === 0 ? (
        <p className="quiet">{t('here.nothing')}</p>
      ) : (
        <ul className="comings">
          {events.map((e) => (
            <li key={`${e.at}-${e.name}-${e.kind}`} data-testid="coming">
              <span>{t(e.kind === 'in' ? 'here.came_in' : 'here.left', { name: e.name })}</span>
              <time>{when(e.at, locale)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
