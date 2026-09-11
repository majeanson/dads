import { ChevronDown, ChevronRight, LogIn, LogOut, MicOff, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CallMember } from '../shared/protocol';
import { fetchPresence, type PresenceEvent } from './api';
import { Face } from './Face';
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
 * you find it by asking rather than by scrolling past it. And behind one more
 * tap: the roster answers the question that opened the sheet, and the log is
 * for the man who wants to know more.
 *
 * The call is read here too. Who is on it, and who has his microphone off,
 * used to be a line of names under the call buttons; that row is worth more
 * as conversation, and a muted man and a quiet one look the same from the far
 * end of a peer connection, so the room has to say which somewhere.
 */
export function Here({
  roster,
  call,
}: {
  roster: { memberId: string; name: string; you: boolean; face?: number }[];
  call: CallMember[];
}) {
  const { t, lang } = useT();
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const [events, setEvents] = useState<PresenceEvent[] | null | 'loading'>('loading');
  const [showLog, setShowLog] = useState(false);
  const onCall = new Map(call.map((m) => [m.memberId, m]));

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
          {roster.map((m) => {
            const c = onCall.get(m.memberId);
            return (
              <li
                key={m.memberId}
                data-testid="roster-entry"
                data-on-call={c ? 'yes' : undefined}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-paper py-1 pr-3 pl-1 text-sm"
              >
                {/* His face, or his initials. The dot went with it: a list
                    titled "Who's here" did not need a mark on every row
                    saying each of them was here. */}
                <Face memberId={m.memberId} name={m.name} version={m.face} size={26} />
                {m.name}
                {m.you ? t('here.you') : ''}
                {c ? (
                  <span className="inline-flex items-center gap-1 text-muted">
                    {c.muted ? (
                      <MicOff size={13} aria-hidden="true" className="text-danger" />
                    ) : (
                      <Phone size={13} aria-hidden="true" className="text-accent" />
                    )}
                    <span className="sr-only">
                      {t('here.on_call')}
                      {c.muted ? `, ${t('here.muted')}` : ''}
                    </span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mt-6 mb-2 text-sm font-semibold text-muted">
        <button
          type="button"
          className="inline-flex min-h-11 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-inherit"
          aria-expanded={showLog}
          onClick={() => setShowLog((v) => !v)}
          data-testid="comings"
        >
          {showLog ? (
            <ChevronDown size={15} aria-hidden="true" />
          ) : (
            <ChevronRight size={15} aria-hidden="true" />
          )}
          {t('here.comings')}
        </button>
      </h2>
      {!showLog ? null : events === 'loading' ? (
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
