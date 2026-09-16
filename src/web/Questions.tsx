import { ArrowLeft, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchPrompts, type HistoryEntry, type PoolEntry } from './api';
import { plural, useT } from './i18n';
import { ITEM } from './Menu';
import { PromptCard } from './PromptCard';
import { AddPromptForm, PromptList } from './PromptList';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import type { RoomMessage } from '../shared/protocol';

/**
 * The questions sheet: today's, and a door to the rest.
 *
 * Today's question is the day's thing to do, and it is the whole first screen
 * — the question, the box to answer it in, and the one-line form for asking
 * something of your own. What the group was asked before used to be listed
 * underneath, which on a phone put the one question that matters at the top
 * of a scroll through every question that no longer does. It is behind one
 * row now, with the count on it, and comes back as its own screen with the
 * same Close and a way back to today.
 *
 * The pool is fetched here rather than in the list, because the row wants the
 * count before anybody has opened it.
 */
export function Questions({
  messages,
  onAnswer,
  canAnswer,
  onClose,
}: {
  messages: RoomMessage[];
  onAnswer: (body: string) => boolean;
  canAnswer: boolean;
  onClose: () => void;
}) {
  const { t, lang } = useT();
  const [view, setView] = useState<'today' | 'before'>('today');
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
          // curated hundred carry no group and are a pool, not reading material.
          mine: data.pool.filter((p) => p.groupId !== null),
          // Today's is the card. Printing it again under "before" is the same
          // question twice on one small screen.
          history: data.history.filter((h) => h.promptId !== data.today?.prompt.id),
        });
      })
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  // What the group was ASKED, not what its dads have added: a question
  // written on Tuesday that the daily pick has not reached is not "1 asked".
  const count = state.status === 'ready' ? state.history.length : 0;
  const [justAdded, setJustAdded] = useState(false);

  function added(entry: PoolEntry) {
    setState((s) => (s.status === 'ready' ? { ...s, mine: [entry, ...s.mine] } : s));
    setJustAdded(true);
  }

  return (
    <Sheet title={view === 'today' ? t('q.title') : t('q.history_title')} onClose={onClose}>
      {view === 'today' ? (
        <div className="grid gap-5">
          <PromptCard messages={messages} onAnswer={onAnswer} canAnswer={canAnswer} />
          {/* No heading: the box says what it is. */}
          <section data-testid="prompt-add" className="grid gap-2">
            <AddPromptForm onAdded={added} />
            {/* The field clearing is the only other sign it worked, and a dad
                who missed it adds the same question again and is refused. */}
            {justAdded ? (
              <p className="m-0 text-sm text-muted" role="status" data-testid="prompt-added">
                {t('q.added')}
              </p>
            ) : null}
          </section>
          <Button
            block
            className={ITEM}
            onClick={() => setView('before')}
            data-testid="prompt-history"
          >
            <History size={22} aria-hidden="true" className="text-muted" />
            {t('q.history')}
            {count > 0 ? (
              <span className="ml-auto text-sm font-normal text-muted">
                {t(`q.history_count_${plural(lang, count)}`, { n: count })}
              </span>
            ) : null}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <Button
            look="quiet"
            className="justify-self-start px-0"
            onClick={() => setView('today')}
            data-testid="prompt-today"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            {t('q.back_today')}
          </Button>
          {state.status === 'loading' ? (
            <p className="m-0 text-muted">{t('q.loading')}</p>
          ) : state.status === 'error' ? (
            <p className="m-0 text-muted">{t('q.failed')}</p>
          ) : (
            <PromptList mine={state.mine} history={state.history} />
          )}
        </div>
      )}
    </Sheet>
  );
}
