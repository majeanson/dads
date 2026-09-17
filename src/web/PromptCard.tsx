import { useEffect, useState, type FormEvent } from 'react';
import { fetchTodaysPrompt, type TodaysPrompt } from './api';
import { PenLine } from 'lucide-react';
import { plural, promptText, useT } from './i18n';
import { Button } from './ui/Button';
import { FIELD } from './ui/field';
import type { RoomMessage } from '../shared/protocol';

/**
 * Today's question, and the box to answer it in.
 *
 * The answer goes into the room as a message rather than into a private
 * store: the whole point is that the others read it. Which is also why this
 * is not on the room's screen: the question is asked once a day, the answers
 * are the conversation, and a card repeating the question above every line is
 * furniture.
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
  const { t, lang } = useT();
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
    <section className="mb-6" data-testid="prompt-card">
      <p className="m-0 text-2xl leading-snug font-medium" data-testid="prompt-body">
        {promptText(lang, today.prompt)}
      </p>

      <p className="mt-2 mb-4 text-base text-muted">
        {answered
          ? t('q.you_answered')
          : answersToday.length === 0
            ? t('q.nobody_answered')
            : t(`q.answers_${plural(lang, answersToday.length)}`, { n: answersToday.length })}
      </p>

      {/* What they said, here, under the question it answers.
          
          The count was the whole of it before: "3 answers." and a full stop,
          with the answers themselves two screens away — close the sheet, walk
          into the conversation, scroll past whatever has been said since. A
          question from March expanded to show its answers and today's did
          not, which is exactly the wrong way round. They are in the room's
          own messages already, so this costs nothing to read. */}
      {answersToday.length > 0 ? (
        <section className="mb-4" data-testid="prompt-answers">
          <h3 className="m-0 mb-1 text-sm font-semibold text-muted">{t('q.what_they_said')}</h3>
          <ul className="m-0 list-none border-l-2 border-line py-0 pl-3">
            {answersToday.map((m) => (
              <li key={m.id} className="py-1.5 text-base" data-testid="prompt-answer">
                <span className="font-semibold">{m.name}</span> {m.body}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {open ? (
        <form className="grid gap-2" onSubmit={submit}>
          <label htmlFor="answer" className="sr-only">
            {t('q.your_answer')}
          </label>
          <textarea
            id="answer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder={t('q.take_your_time')}
            className={`${FIELD} resize-y`}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" look="primary" size="lg" disabled={!canAnswer || !draft.trim()}>
              {t('q.answer')}
            </Button>
            <Button look="quiet" size="lg" onClick={() => setOpen(false)}>
              {t('q.not_now')}
            </Button>
          </div>
        </form>
      ) : (
        <Button size="lg" onClick={() => setOpen(true)}>
          <PenLine size={18} aria-hidden="true" />
          {answered ? t('q.say_more') : t('q.answer')}
        </Button>
      )}
    </section>
  );
}
