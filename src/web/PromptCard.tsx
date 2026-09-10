import { useEffect, useState, type FormEvent } from 'react';
import { fetchTodaysPrompt, type TodaysPrompt } from './api';
import type { RoomMessage } from '../shared/protocol';

/**
 * Today's question, and the box to answer it in.
 *
 * The answer goes into the room as a message rather than into a private
 * store: the whole point is that the others read it.
 */
export function PromptCard({
  messages,
  onAnswer,
  canAnswer,
}: {
  messages: RoomMessage[];
  onAnswer: (body: string) => boolean;
  canAnswer: boolean;
}) {
  const [today, setToday] = useState<TodaysPrompt | null | 'loading'>('loading');
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTodaysPrompt()
      .then((t) => !cancelled && setToday(t))
      .catch(() => !cancelled && setToday(null));
    return () => {
      cancelled = true;
    };
  }, []);

  // Once an answer of ours comes back through the room, the card knows without
  // asking the server again.
  const promptId = today !== 'loading' && today ? today.prompt.id : null;
  const answersToday = messages.filter((m) => m.kind === 'prompt' && m.promptId === promptId);
  const answered = (today !== 'loading' && today?.answered) || false;

  if (today === 'loading' || !today) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (onAnswer(body)) {
      setDraft('');
      setOpen(false);
      setToday((t) => (t && t !== 'loading' ? { ...t, answered: true } : t));
    }
  }

  return (
    <section className="prompt-card" data-testid="prompt-card">
      <p className="prompt-eyebrow">Today’s question</p>
      <p className="prompt-body" data-testid="prompt-body">
        {today.prompt.body}
      </p>

      <p className="prompt-meta">
        {answersToday.length === 0
          ? 'Nobody has answered yet.'
          : `${answersToday.length} answer${answersToday.length === 1 ? '' : 's'} so far.`}
        {answered ? ' You’ve answered.' : ''}
      </p>

      {open ? (
        <form className="prompt-answer" onSubmit={submit}>
          <label htmlFor="answer" className="sr-only">
            Your answer
          </label>
          <textarea
            id="answer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Take your time."
          />
          <div className="prompt-actions">
            <button type="submit" disabled={!canAnswer || !draft.trim()}>
              Answer
            </button>
            <button type="button" className="link" onClick={() => setOpen(false)}>
              Not now
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="prompt-open" onClick={() => setOpen(true)}>
          {answered ? 'Say more' : 'Answer'}
        </button>
      )}
    </section>
  );
}
