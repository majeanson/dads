import { useEffect, useState, type FormEvent } from 'react';
import {
  addPrompt,
  fetchPromptAnswers,
  fetchPrompts,
  type HistoryEntry,
  type PoolEntry,
  type Prompt,
  type PromptAnswer,
} from './api';

const ADD_ERRORS: Record<string, string> = {
  empty: 'Write the question first.',
  too_long: 'That’s long for a question — 240 characters or fewer.',
  already_asked: 'That one is already in the list.',
  unknown: 'Couldn’t add that. Try again.',
};

/**
 * Every question the group can be asked, in one list: what was asked when,
 * what the group said, and what is still waiting its turn.
 */
export function PromptList() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | {
        status: 'ready';
        today: { day: string; prompt: Prompt } | null;
        pool: PoolEntry[];
        history: HistoryEntry[];
      }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchPrompts()
      .then((data) => !cancelled && setState({ status: 'ready', ...data }))
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') return <p className="quiet">Fetching the list…</p>;
  if (state.status === 'error') return <p className="quiet">Couldn’t load the prompts.</p>;

  const { today, pool, history } = state;
  const mine = pool.filter((p) => p.groupId !== null);
  const library = pool.filter((p) => p.groupId === null);
  const askedIds = new Set(history.map((h) => h.promptId));

  function added(entry: PoolEntry) {
    setState((s) => (s.status === 'ready' ? { ...s, pool: [entry, ...s.pool] } : s));
  }

  return (
    <div className="prompt-list" data-testid="prompt-list">
      {today ? (
        <section>
          <h2>Today</h2>
          <ol className="prompts">
            <PromptRow
              key={today.prompt.id}
              id={today.prompt.id}
              body={today.prompt.body}
              badges={['today']}
              answers={history.find((h) => h.promptId === today.prompt.id)?.answers ?? 0}
            />
          </ol>
        </section>
      ) : null}

      <section>
        <h2>
          Asked before <span className="count">{history.length}</span>
        </h2>
        {history.length === 0 ? (
          <p className="quiet">Nothing yet. The first question lands tomorrow.</p>
        ) : (
          <ol className="prompts">
            {history.map((h) => (
              <PromptRow
                key={`${h.day}-${h.promptId}`}
                id={h.promptId}
                body={h.body}
                badges={[h.day]}
                answers={h.answers}
              />
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2>
          Yours <span className="count">{mine.length}</span>
        </h2>
        <AddPromptForm onAdded={added} />
        {mine.length === 0 ? (
          <p className="quiet">None yet. Add a question you actually want answered.</p>
        ) : (
          <ol className="prompts">
            {mine.map((p) => (
              <PromptRow
                key={p.id}
                id={p.id}
                body={p.body}
                badges={[
                  p.authorName ? `by ${p.authorName}` : 'yours',
                  ...(askedIds.has(p.id) ? [] : ['not asked yet']),
                ]}
                answers={p.answers}
              />
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2>
          The library <span className="count">{library.length}</span>
        </h2>
        <ol className="prompts">
          {library.map((p) => (
            <PromptRow
              key={p.id}
              id={p.id}
              body={p.body}
              badges={
                p.timesAsked > 0
                  ? [`asked ${p.timesAsked}×`, ...(p.lastAsked ? [p.lastAsked] : [])]
                  : []
              }
              answers={p.answers}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}

/** One question. Clicking it shows what the group said, fetched on demand so
 * opening the list does not pull down every answer ever given. */
function PromptRow({
  id,
  body,
  badges,
  answers,
}: {
  id: string;
  body: string;
  badges: string[];
  answers: number;
}) {
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
          {badges.map((b) => (
            <span key={b} className="badge">
              {b}
            </span>
          ))}
          {answers > 0 ? (
            <span className="badge is-answered">
              {answers} answer{answers === 1 ? '' : 's'}
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
      setError(ADD_ERRORS[result.error] ?? ADD_ERRORS.unknown!);
    }
  }

  return (
    <form className="add-prompt" onSubmit={submit}>
      <label htmlFor="new-prompt" className="sr-only">
        A question for the group
      </label>
      <input
        id="new-prompt"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a question for the group"
        maxLength={240}
      />
      <button type="submit" disabled={busy || !body.trim()}>
        Add
      </button>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
