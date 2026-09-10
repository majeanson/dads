import { useEffect, useState, type FormEvent } from 'react';
import {
  addPrompt,
  fetchPromptAnswers,
  fetchPrompts,
  type HistoryEntry,
  type PoolEntry,
  type PromptAnswer,
} from './api';

const ADD_ERRORS: Record<string, string> = {
  empty: 'Write the question first.',
  too_long: 'That’s long for a question — 240 characters or fewer.',
  already_asked: 'That one is already in the list.',
  unknown: 'Couldn’t add that. Try again.',
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

  if (state.status === 'loading') return <p className="quiet">Fetching the list…</p>;
  if (state.status === 'error') return <p className="quiet">Couldn’t load the prompts.</p>;

  const { mine, history } = state;

  function added(entry: PoolEntry) {
    setState((s) => (s.status === 'ready' ? { ...s, mine: [entry, ...s.mine] } : s));
  }

  return (
    <div className="prompt-list" data-testid="prompt-list">
      <section>
        <h2>Asked before</h2>
        {history.length === 0 ? (
          <p className="quiet">Nothing yet. The first question lands tomorrow.</p>
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
        <h2>Add a question</h2>
        <AddPromptForm onAdded={added} />
        {mine.length === 0 ? null : (
          <ol className="prompts">
            {mine.map((p) => (
              <PromptRow
                key={p.id}
                id={p.id}
                body={p.body}
                meta={p.authorName ? `by ${p.authorName}` : 'yours'}
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
