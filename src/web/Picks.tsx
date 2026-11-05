import { ListPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PICK_CATEGORIES, type PickCategory } from '../shared/pickCategories';
import type { PickItem } from '../shared/picks';
import { MAX_MESSAGE_LENGTH } from '../shared/protocol';
import { fetchPicks, removePick, type PicksOnly } from './api';
import { Face } from './Face';
import { useT } from './i18n';
import { useLinkCard } from './LinkCard';
import { useNameOf } from './members';
import { segment, TRACK } from './Toggles';
import { Button } from './ui/Button';
import { FIELD } from './ui/field';
import { ITEM } from './Menu';
import { hostOf } from '../shared/unfurl';
import { shortLink } from '../shared/linkify';

type State = { status: 'looking' } | { status: 'failed' } | { status: 'ready'; picks: PickItem[] };

const FILTERS: PicksOnly[] = ['all', 'watch', 'listen', 'read'];

/**
 * What the room has recommended: the lines that hold a link to something to
 * watch, listen to or read, as cards, newest first.
 *
 * Mostly a view of the conversation: a line with a link from a known site is
 * here without anybody doing anything, and a line taken back is gone from it.
 * A line can also be put here by hand (the line menu, or the add box below,
 * which posts an ordinary line because recommending is saying). The filter
 * asks the Worker rather than hiding rows, so "Read" is the newest books and
 * not whatever of the newest videos happened to be books. A tap goes to the
 * link, in its own tab; there is no player in the app. Re-read on a `picks`
 * stir, `pulse`.
 */
export function Picks({
  you,
  send,
  pulse,
}: {
  you: string;
  send: (body: string, mediaId?: string, replyTo?: string, pick?: PickCategory) => void;
  pulse: number;
}) {
  const { t } = useT();
  const [only, setOnly] = useState<PicksOnly>('all');
  const [state, setState] = useState<State>({ status: 'looking' });
  const [again, setAgain] = useState(0);
  const [refused, setRefused] = useState(false);
  const shown = useRef<PicksOnly | null>(null);

  useEffect(() => {
    const stop = new AbortController();
    // Only a new filter blanks the list; a stir or a removal re-reads under it.
    if (shown.current !== only) setState({ status: 'looking' });
    shown.current = only;
    fetchPicks(only, stop.signal).then(
      (picks) => setState({ status: 'ready', picks }),
      () => {
        if (!stop.signal.aborted) setState({ status: 'failed' });
      },
    );
    return () => stop.abort();
  }, [only, pulse, again]);

  const take = (id: string) => {
    setRefused(false);
    void removePick(id).then((ok) => {
      if (ok) setAgain((n) => n + 1);
      else setRefused(true);
    });
  };

  return (
    <div className="grid gap-3" data-testid="picks">
      <p className="m-0 text-base text-muted">{t('picks.lede')}</p>
      <AddBox send={send} />
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
            <Card key={p.id} pick={p} mine={p.addedBy === you} onTake={take} />
          ))}
        </ul>
      )}
      {refused ? (
        <p className="error m-0" role="alert">
          {t('picks.remove_failed')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Behind a row, like a question of your own on the questions sheet: the list
 * keeps the screen, and an empty box is never in the way of reading it.
 * Posts an ordinary line, because recommending is saying, and asks for it to
 * be listed under the kind chosen (Read first: the one a link cannot find).
 * It goes through the room's own send, so it works with the socket down.
 */
function AddBox({
  send,
}: {
  send: (body: string, mediaId?: string, replyTo?: string, pick?: PickCategory) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<PickCategory>('read');
  const [sent, setSent] = useState(false);

  return (
    <section className="grid grid-cols-1 gap-2" data-testid="picks-add">
      <Button
        block
        className={ITEM}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="picks-add-open"
      >
        <ListPlus size={22} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{t('picks.add_open')}</span>
      </Button>
      {open ? (
        <form
          className="grid grid-cols-1 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const body = text.trim();
            if (body === '') return;
            send(body, undefined, undefined, kind);
            setText('');
            setSent(true);
          }}
        >
          <label className="grid gap-1.5 text-base font-semibold" htmlFor="picks-add-text">
            {t('picks.add_label')}
            <input
              id="picks-add-text"
              className={FIELD}
              value={text}
              maxLength={MAX_MESSAGE_LENGTH}
              autoComplete="off"
              onChange={(e) => {
                setText(e.target.value);
                setSent(false);
              }}
            />
          </label>
          <div className={`${TRACK} w-full`} role="group" aria-label={t('picks.add_kind')}>
            {PICK_CATEGORIES.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={kind === id}
                onClick={() => setKind(id)}
                className={segment(kind === id, 'flex-1 text-base font-semibold')}
                data-testid={`picks-add-${id}`}
              >
                {t(`picks.only_${id}`)}
              </button>
            ))}
          </div>
          <Button type="submit" look="primary" size="lg" block data-testid="picks-add-send">
            {t('picks.add_send')}
          </Button>
          {sent ? (
            <p className="m-0 text-sm text-muted" role="status" data-testid="picks-added">
              {t('picks.added')}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
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
      // The sheet scrolls inside its own panel, and `rootMargin` of the
      // implicit root stops at that panel's clip; `scrollMargin` is the
      // option that reaches into a scroller between the target and the root.
      // A browser without it (before Chrome 120) just loads on arrival.
      { rootMargin: '100% 0px', scrollMargin: '100% 0px' } as IntersectionObserverInit,
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [near]);
  return [ref, near];
}

function Card({
  pick,
  mine,
  onTake,
}: {
  pick: PickItem;
  mine: boolean;
  onTake: (id: string) => void;
}) {
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
      {pick.url === null ? (
        // Words alone: what he typed, never translated, and no fake link.
        <p
          className="m-0 line-clamp-4 break-words whitespace-pre-line text-base"
          data-testid="pick-words"
        >
          {pick.body}
        </p>
      ) : near ? (
        <Linked url={pick.url} />
      ) : (
        <Plain href={pick.url} />
      )}
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
      {mine ? (
        <Button
          look="quiet"
          size="sm"
          className="min-h-11 justify-self-start"
          onClick={() => onTake(pick.id)}
          aria-label={t('picks.remove_what', { what: describe(pick) })}
          data-testid="pick-remove"
        >
          {t('picks.remove')}
        </Button>
      ) : null}
    </li>
  );
}

/** What the card is, for the button that takes it off: his words or its host. */
function describe(pick: PickItem): string {
  const words = pick.body.trim().replace(/\s+/g, ' ');
  if (words !== '') return [...words].length > 40 ? [...words].slice(0, 39).join('') + '…' : words;
  return pick.url === null ? '' : hostOf(pick.url);
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
function Linked({ url }: { url: string }) {
  const card = useLinkCard(url);
  if (!card) return <Plain href={url} />;
  return (
    <a
      className={LINK}
      href={url}
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
        <span className="truncate text-sm text-muted">{card.site || hostOf(url)}</span>
        <span className="line-clamp-2 text-base font-semibold">{card.title}</span>
        {card.description ? (
          <span className="line-clamp-2 text-sm text-muted">{card.description}</span>
        ) : null}
      </span>
    </a>
  );
}
