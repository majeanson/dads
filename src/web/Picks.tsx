import { useEffect, useRef, useState } from 'react';
import type { PickCategory, PickItem } from '../shared/picks';
import { fetchPicks, type PicksOnly } from './api';
import { Face } from './Face';
import { useT } from './i18n';
import { useLinkCard } from './LinkCard';
import { useNameOf } from './members';
import { segment, TRACK } from './Toggles';
import { hostOf } from '../shared/unfurl';
import { shortLink } from '../shared/linkify';

type State = { status: 'looking' } | { status: 'failed' } | { status: 'ready'; picks: PickItem[] };

const FILTERS: PicksOnly[] = ['all', 'watch', 'listen', 'read'];

/**
 * What the room has recommended: the lines that hold a link to something to
 * watch, listen to or read, as cards, newest first.
 *
 * A view of the conversation and nothing else — there is nothing to post
 * here, and a line taken back is gone from it. The filter asks the Worker
 * rather than hiding rows, so "Read" is the newest books and not whatever of
 * the newest videos happened to be books. A tap goes to the link, in its own
 * tab; there is no player in the app.
 */
export function Picks() {
  const { t } = useT();
  const [only, setOnly] = useState<PicksOnly>('all');
  const [state, setState] = useState<State>({ status: 'looking' });

  useEffect(() => {
    const stop = new AbortController();
    setState({ status: 'looking' });
    fetchPicks(only, stop.signal).then(
      (picks) => setState({ status: 'ready', picks }),
      () => {
        if (!stop.signal.aborted) setState({ status: 'failed' });
      },
    );
    return () => stop.abort();
  }, [only]);

  return (
    <div className="grid gap-3" data-testid="picks">
      <p className="m-0 text-base text-muted">{t('picks.lede')}</p>
      <div className={`${TRACK} w-full`} role="group" aria-label={t('picks.only')}>
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={only === id}
            onClick={() => setOnly(id)}
            className={segment(only === id, 'flex-1 text-base font-semibold')}
          >
            {t(`picks.only_${id}`)}
          </button>
        ))}
      </div>

      {state.status === 'looking' ? (
        <p className="quiet m-0">…</p>
      ) : state.status === 'failed' ? (
        <p className="error m-0" role="alert">
          {t('picks.failed')}
        </p>
      ) : state.picks.length === 0 ? (
        <p className="quiet m-0" data-testid="picks-empty">
          {t(only === 'all' ? 'picks.empty' : `picks.empty_${only}`)}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {state.picks.map((p) => (
            <Card key={p.id} pick={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Has this element come near the screen. Once it has, it stays so: the card
 * keeps what it fetched when it scrolls away again.
 */
function useNear(): [React.RefObject<HTMLLIElement | null>, boolean] {
  const ref = useRef<HTMLLIElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || el === null) return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          watch.disconnect();
        }
      },
      // A screen of lead, so the card is drawn before the thumb arrives.
      { rootMargin: '100% 0px' },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [near]);
  return [ref, near];
}

function Card({ pick }: { pick: PickItem }) {
  const { t, lang } = useT();
  const nameOf = useNameOf();
  const [ref, near] = useNear();
  const when = new Date(pick.createdAt).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric',
    month: 'short',
  });
  const name = pick.name === '' ? '…' : pick.name;

  return (
    <li
      ref={ref}
      className="grid gap-2 rounded-[var(--radius-control)] border border-line p-3"
      data-testid="pick"
      data-category={pick.category satisfies PickCategory}
    >
      <p className="m-0 flex items-center gap-2 text-base text-muted">
        {pick.memberId !== null && !pick.gone ? <Face memberId={pick.memberId} size={28} /> : null}
        <span className="min-w-0 truncate">{t('picks.by', { name, when })}</span>
      </p>
      {near ? <Linked pick={pick} /> : <Plain href={pick.url} />}
      {pick.marks.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-base">
          {pick.marks.map((m) => (
            <li key={m.emoji} data-testid="pick-mark">
              <span aria-hidden="true">
                {m.emoji} {m.by.length}
              </span>
              <span className="sr-only">
                {m.emoji} {m.by.map((id) => nameOf(id)).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const LINK =
  'flex min-h-11 items-stretch gap-2.5 overflow-hidden rounded-[var(--radius-control)] border border-edge bg-soft text-ink no-underline';

/** The address alone: before the card is near, or when the page said nothing. */
function Plain({ href }: { href: string }) {
  return (
    <a
      className={`${LINK} items-center px-3 py-2 text-base break-all`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="pick-link"
    >
      {shortLink(href)}
    </a>
  );
}

/** Mounts only once the card is near, so this is where the page is asked for. */
function Linked({ pick }: { pick: PickItem }) {
  const card = useLinkCard(pick.url);
  if (!card) return <Plain href={pick.url} />;
  return (
    <a
      className={LINK}
      href={pick.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="pick-link"
    >
      {card.image ? (
        <img
          className="w-24 flex-none bg-line object-cover"
          src={card.image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={(e) => e.currentTarget.remove()}
        />
      ) : null}
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
        <span className="truncate text-sm text-muted">{card.site || hostOf(pick.url)}</span>
        <span className="line-clamp-2 text-base font-semibold">{card.title}</span>
        {card.description ? (
          <span className="line-clamp-2 text-sm text-muted">{card.description}</span>
        ) : null}
      </span>
    </a>
  );
}
