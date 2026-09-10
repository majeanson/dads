import { useEffect, useState, type FormEvent } from 'react';
import {
  addPrompt,
  fetchPromptAnswers,
  fetchPrompts,
  type HistoryEntry,
  type PoolEntry,
  type PromptAnswer,
} from './api';
import { plural, useT, type Key } from './i18n';

const ADD_ERRORS: Record<string, Key> = {
  empty: 'q.add_empty',
  too_long: 'q.add_too_long',
  already_asked: 'q.add_already',
  unknown: 'q.add_unknown',
};

/**
 * What has been asked before, and how to ask something new.
 *
 * The curated hundred are deliberately NOT listed. They are the pool the daily
 * pick draws from, not reading material: a dad scrolling a hundred questions
 * nobody has answered is a dad doing filing. What is worth showing is what
 * this group has actually said, and the door to add one of your own.
 */
export function PromptList() {
  const { t } = useT();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; mine: PoolEntry[]; history: HistoryEntry[] }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchPrompts()
      .then((data) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          // A dad's own questions are the ones with a group behind them; the
          // library rows carry no group and are not shown.
          mine: data.pool.filter((p) => p.groupId !== null),
          // Today's is the card above this list. Printing it again under
          // 'asked before' is the same question twice on one small screen.
          history: data.history.filter((h) => h.promptId !== data.today?.prompt.id),
        });
      })
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') return <p className="quiet">{t('q.loading')}</p>;
  if (state.status === 'error') return <p className="quiet">{t('q.failed')}</p>;

  const { mine, history } = state;

  function added(entry: PoolEntry) {
    setState((s) => (s.status === 'ready' ? { ...s, mine: [entry, ...s.mine] } : s));
  }

  return (
    <div className="prompt-list" data-testid="prompt-list">
      <section>
        <h2>{t('q.asked_before')}</h2>
        {history.length === 0 ? (
          <p className="quiet">{t('q.first_tomorrow')}</p>
        ) : (
          <ol className="prompts">
            {history.map((h) => (
              <PromptRow
                key={`${h.day}-${h.promptId}`}
                id={h.promptId}
                body={h.body}
                answers={h.answers}
              />
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2>{t('q.add')}</h2>
        <AddPromptForm onAdded={added} />
        {mine.length === 0 ? null : (
          <ol className="prompts">
            {mine.map((p) => (
              <PromptRow
                key={p.id}
                id={p.id}
                body={p.body}
                meta={p.authorName ? t('q.by', { name: p.authorName }) : t('q.yours')}
                answers={p.answers}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** One question. Clicking it shows what the group said, fetched on demand so
 * opening the list does not pull down every answer ever given. */
function PromptRow({
  id,
  body,
  meta,
  answers,
}: {
  id: string;
  body: string;
  meta?: string;
  answers: number;
}) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<PromptAnswer[] | null>(null);

  useEffect(() => {
    if (!open || loaded || answers === 0) return;
    let cancelled = false;
    fetchPromptAnswers(id)
      .then((a) => !cancelled && setLoaded(a))
      .catch(() => !cancelled && setLoaded([]));
    return () => {
      cancelled = true;
    };
  }, [open, loaded, answers, id]);

  return (
    <li className="prompt-row" data-testid="prompt-row">
      <button
        type="button"
        className="prompt-row-main"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={answers === 0}
      >
        <span className="prompt-row-body">{body}</span>
        <span className="prompt-row-meta">
          {meta ? <span>{meta}</span> : null}
          {answers > 0 ? (
            <span className="is-answered">
              {t(`q.n_answers_${plural(lang, answers)}`, { n: answers })}
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <ul className="prompt-answers">
          {loaded === null ? (
            <li className="quiet">…</li>
          ) : (
            loaded.map((a) => (
              <li key={a.id}>
                <span className="who">{a.name}</span> {a.body}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

function AddPromptForm({ onAdded }: { onAdded: (entry: PoolEntry) => void }) {
  const { t } = useT();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await addPrompt(body);
    setBusy(false);
    if (result.ok) {
      onAdded(result.prompt);
      setBody('');
    } else {
      setError(t(ADD_ERRORS[result.error] ?? 'q.add_unknown'));
    }
  }

  return (
    <form className="add-prompt" onSubmit={submit}>
      <label htmlFor="new-prompt" className="sr-only">
        {t('q.add_label')}
      </label>
      <input
        id="new-prompt"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('q.add_placeholder')}
        maxLength={240}
      />
      <button type="submit" disabled={busy || !body.trim()}>
        {t('q.add_button')}
      </button>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
