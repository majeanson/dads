import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { MIN_SEARCH, type Found } from '../shared/protocol';
import { highlight } from '../shared/highlight';
import { findLines } from './api';
import { Attachment } from './Attachment';
import { Face } from './Face';
import { useT } from './i18n';
import { FIELD } from './ui/field';

/** Long enough that a thumb finishes a word, short enough to feel live. */
const SETTLE_MS = 250;

function when(ts: number, locale: string): string {
  const day = new Date(ts);
  const time = day.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const date = day.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    // The year only when it is not this one — "12 Mar" is how anyone says it,
    // and a search that reaches back two years needs to say which.
    ...(day.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}

type State =
  | { status: 'idle' }
  | { status: 'looking' }
  | { status: 'failed' }
  | { status: 'ready'; q: string; results: Found[] };

/**
 * Finding a line again.
 *
 * The room backfills five hundred lines and the archive in D1 is uncapped, so
 * for five men talking for a year almost everything they have said is on the
 * disk and out of reach. Scrolling is not a way back to it: a thing said in
 * March is ten thousand lines up.
 *
 * It searches what somebody TYPED and nothing else — the room's own lines are
 * furniture, and fifty of them would bury the one line he wanted. Results are
 * newest first, because the half-remembered thing is nearly always the recent
 * thing.
 *
 * There is nowhere to go from a result, on purpose: the line, who said it and
 * when is the whole of the answer, and a picture opens where it sits. Jumping
 * the conversation to a line from March would mean fetching ten thousand lines
 * to arrive at the top of them.
 */
export function Find() {
  const { t, lang } = useT();
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const [q, setQ] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const field = useRef<HTMLInputElement>(null);

  // The sheet opened because he wants to type. Nothing else in it is worth
  // a tap first.
  useEffect(() => {
    field.current?.focus();
  }, []);

  const needle = q.trim();
  useEffect(() => {
    if (needle.length < MIN_SEARCH) {
      setState({ status: 'idle' });
      return;
    }
    // Abort rather than ignore: a man typing a word makes five of these, and
    // the fourth answering after the fifth would show him the wrong results.
    const stop = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: 'looking' });
      findLines(needle, stop.signal)
        .then((results) => setState({ status: 'ready', q: needle, results }))
        .catch((err: unknown) => {
          if (stop.signal.aborted) return;
          console.error('search failed', err);
          setState({ status: 'failed' });
        });
    }, SETTLE_MS);

    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [needle]);

  return (
    <div data-testid="find">
      <label htmlFor="find-q" className="sr-only">
        {t('find.field')}
      </label>
      <div className="relative">
        <Search
          size={20}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
        />
        <input
          ref={field}
          id="find-q"
          className={`${FIELD} pl-12`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('find.field')}
          autoComplete="off"
          // The keyboard's own return key says what it does, and there is no
          // form to submit: the results are already there.
          enterKeyHint="search"
        />
      </div>

      <div aria-live="polite" className="mt-4">
        {state.status === 'idle' ? (
          <p className="text-[1.0625rem] text-muted">{t('find.lede')}</p>
        ) : state.status === 'looking' ? (
          <p className="text-[1.0625rem] text-muted">{t('find.looking')}</p>
        ) : state.status === 'failed' ? (
          <p className="error" role="alert">
            {t('find.failed')}
          </p>
        ) : state.results.length === 0 ? (
          <p className="text-[1.0625rem] text-muted" data-testid="find-nothing">
            {t('find.nothing', { q: state.q })}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {state.results.map((r) => (
              <li
                key={r.id}
                data-testid="found"
                className="border-b border-line py-3 last:border-0"
              >
                <p className="flex items-center gap-2.5 text-base text-muted">
                  {r.memberId === null ? null : <Face memberId={r.memberId} size={28} />}
                  <span className="truncate text-ink">{r.name || t('line.someone')}</span>
                  <time className="ml-auto shrink-0 text-sm tabular-nums">
                    {when(r.at, locale)}
                  </time>
                </p>
                <p className="mt-1 text-[1.0625rem] wrap-anywhere whitespace-pre-wrap">
                  {r.kind === 'prompt' ? (
                    <span className="answer-tag">{t('line.answered')}</span>
                  ) : null}
                  {highlight(r.body, state.q).map((piece, i) =>
                    piece.hit ? (
                      <mark key={i} className="rounded-sm bg-accent/20 text-ink">
                        {piece.text}
                      </mark>
                    ) : (
                      <span key={i}>{piece.text}</span>
                    ),
                  )}
                </p>
                {/* No `onOpen`: the viewer holds the photographs that are in
                    the conversation, and this one may be older than every
                    line still loaded. It shows where it sits. */}
                {r.media ? <Attachment media={r.media} /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
