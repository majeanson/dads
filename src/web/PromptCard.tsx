import { useEffect, useState, type FormEvent } from 'react';
import {
  anotherPrompt,
  choosePrompt,
  fetchTodaysPrompt,
  type PoolEntry,
  type TodaysPrompt,
} from './api';
import { ListChecks, PenLine, Shuffle } from 'lucide-react';
import { dadVar } from './dadColour';
import { Face } from './Face';
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
  host,
  pool,
}: {
  messages: RoomMessage[];
  onAnswer: (body: string) => boolean;
  canAnswer: boolean;
  /** The creator, or anybody in a room with none: may pick the question. */
  host: boolean;
  /** Everything the room can be asked, for the host's picker. */
  pool: PoolEntry[];
}) {
  const { t, lang } = useT();
  const [today, setToday] = useState<TodaysPrompt | null | 'loading'>('loading');
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapFailed, setSwapFailed] = useState(false);
  const [choosing, setChoosing] = useState(false);

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

  async function another() {
    setSwapping(true);
    setSwapFailed(false);
    try {
      const next = await anotherPrompt();
      if (next) setToday(next);
      else setSwapFailed(true);
    } catch {
      setSwapFailed(true);
    } finally {
      setSwapping(false);
    }
  }

  async function choose(id: string) {
    setSwapping(true);
    setSwapFailed(false);
    try {
      const next = await choosePrompt(id);
      if (next) {
        setToday(next);
        setChoosing(false);
      } else setSwapFailed(true);
    } catch {
      setSwapFailed(true);
    } finally {
      setSwapping(false);
    }
  }

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
    // On a card, the way home puts the night on one: a screen with one
    // question on it reads as being ABOUT that question when the question
    // has an edge. The quote mark is the accent's one job here.
    <section
      className="rounded-[var(--radius-card)] bg-panel p-[clamp(1rem,3dvh,1.5rem)]"
      data-testid="prompt-card"
    >
      <span aria-hidden="true" className="display block h-6 text-6xl leading-none text-accent">
        “
      </span>
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
          <ul className="m-0 grid list-none gap-2 p-0">
            {answersToday.map((m) => (
              <li key={m.id} className="flex gap-2.5 text-base" data-testid="prompt-answer">
                {m.memberId ? <Face memberId={m.memberId} size={26} /> : null}
                <span className="min-w-0">
                  <span
                    className="font-semibold"
                    style={m.memberId ? { color: dadVar(m.memberId) } : undefined}
                  >
                    {m.name}
                  </span>{' '}
                  {m.body}
                </span>
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
        // The card's one action, filled until he has answered; after that it
        // is the quieter "say more".
        <Button
          size="lg"
          look={answered ? 'plain' : 'primary'}
          className="w-full"
          onClick={() => setOpen(true)}
        >
          <PenLine size={18} aria-hidden="true" />
          {answered ? t('q.say_more') : t('q.answer')}
        </Button>
      )}

      {/* A way out of a question that is the wrong one today. Only while
          nobody has answered: an answer belongs to the question it answered. */}
      {!open && !answered && answersToday.length === 0 ? (
        <div className="mt-2 grid">
          <Button
            look="quiet"
            size="lg"
            disabled={swapping}
            onClick={() => void another()}
            data-testid="prompt-another"
          >
            <Shuffle size={18} aria-hidden="true" />
            {t('q.another')}
          </Button>
          {host ? (
            <>
              <Button
                look="quiet"
                size="lg"
                onClick={() => setChoosing((c) => !c)}
                aria-expanded={choosing}
                data-testid="prompt-choose"
              >
                <ListChecks size={18} aria-hidden="true" />
                {choosing ? t('q.choose_close') : t('q.choose')}
              </Button>
              {choosing ? (
                <ul
                  className="m-0 mt-1 grid max-h-[40dvh] list-none gap-1 overflow-y-auto overscroll-contain p-0"
                  data-testid="prompt-choices"
                >
                  {pool
                    .filter((p) => p.id !== today.prompt.id)
                    .map((p) => (
                      <li key={p.id}>
                        <Button
                          block
                          disabled={swapping}
                          className="h-auto min-h-11 justify-start py-2 text-left text-base font-normal whitespace-normal"
                          onClick={() => void choose(p.id)}
                          data-testid="prompt-choice"
                        >
                          {promptText(lang, p)}
                        </Button>
                      </li>
                    ))}
                </ul>
              ) : null}
            </>
          ) : null}
          {swapFailed ? (
            <p className="m-0 text-center text-sm text-danger" role="alert">
              {t('q.another_failed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
