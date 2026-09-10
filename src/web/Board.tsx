import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { weekDate } from '../shared/week';
import {
  fetchBoard,
  saveCheckIn,
  saveCommitment,
  saveCommitmentOutcome,
  type BoardData,
  type BoardRow,
} from './api';
import { Check } from 'lucide-react';
import { useT, type Key, type T } from './i18n';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { FIELD } from './ui/field';

const RATING: Key[] = [
  'b.rating_1',
  'b.rating_1',
  'b.rating_2',
  'b.rating_3',
  'b.rating_4',
  'b.rating_5',
];

function ratingWord(t: T, rating: number): string {
  return t(RATING[rating] ?? 'b.rating_3');
}

function outcomeWord(t: T, outcome: 'pending' | 'done' | 'missed'): string {
  return t(outcome === 'done' ? 'b.kept' : outcome === 'missed' ? 'b.missed' : 'b.trying');
}

/**
 * The week, in public. Nobody is left out — a board that only shows the dads
 * who turned up is a board that flatters — but the men with nothing down yet
 * share one line rather than each getting a row that says nothing.
 */
export function Board({ onChanged }: { onChanged?: () => void } = {}) {
  const { t, lang } = useT();
  const [data, setData] = useState<BoardData | null | 'loading'>('loading');
  const reload = useCallback(() => {
    fetchBoard()
      .then((d) => {
        setData(d);
        // The menu's mark is about this dad's week, which may have just changed.
        onChanged?.();
      })
      .catch(() => setData(null));
  }, [onChanged]);

  useEffect(reload, [reload]);

  if (data === 'loading') return <p className="text-muted">{t('b.loading')}</p>;
  if (!data) return <p className="text-muted">{t('b.failed')}</p>;

  const [thisWeek, ...before] = data.weeks;
  const mine = thisWeek?.rows.find((r) => r.memberId === data.you) ?? null;

  return (
    <div data-testid="board">
      {data.pending ? <HowDidItGo pending={data.pending} onSaved={reload} /> : null}

      <section>
        <YourWeek row={mine} onSaved={reload} />
        {/* Your own row stays in the list, not just in the editor above it:
            the whole feature is group-visible by design, and you should be
            able to read your week in the same words everyone else reads it. */}
        <WeekRows rows={thisWeek?.rows ?? []} you={data.you} className="mt-4" />
      </section>

      {/* A week nobody filled in is not a week worth printing: four
          'nothing from anyone' headings is a scroll through an empty diary. */}
      {before
        .filter((w) => w.rows.some((r) => r.checkIn ?? r.commitment))
        .map((w) => {
          const kept = w.rows.filter((r) => r.commitment?.outcome === 'done').length;
          const promised = w.rows.filter((r) => r.commitment).length;
          return (
            <section key={w.week} className="mt-6">
              {/* The follow-through number is the whole point of the week
                behind you, so it stays — as words, not a badge. */}
              <h2 className="mb-1 text-sm font-semibold text-muted">
                {t('b.week_of', { date: weekDate(w.week, lang) })}
                {promised > 0 ? ` · ${t('b.kept_count', { kept, total: promised })}` : ''}
              </h2>
              <WeekRows rows={w.rows} you={data.you} />
            </section>
          );
        })}
    </div>
  );
}

/**
 * A week's rows, and one line for everybody who has not filled it in.
 *
 * Nobody is hidden — a board that only shows the dads who turned up is a board
 * that flatters — but a row each for five men with nothing to say is five rows
 * of the same three words. The names are the honesty; the rows were furniture.
 */
function WeekRows({ rows, you, className }: { rows: BoardRow[]; you: string; className?: string }) {
  const { t } = useT();
  const said = rows.filter((r) => r.checkIn ?? r.commitment);
  const quiet = rows.filter((r) => !r.checkIn && !r.commitment);
  return (
    <ul className={cn('m-0 list-none border-t border-line p-0', className)}>
      {said.map((row) => (
        <BoardEntry key={row.memberId} row={row} isYou={row.memberId === you} />
      ))}
      {quiet.length > 0 ? (
        <li className="border-b border-line py-2.5 text-muted" data-testid="board-waiting">
          {t('b.waiting', {
            names: quiet.map((r) => r.name + (r.memberId === you ? t('here.you') : '')).join(', '),
          })}
        </li>
      ) : null}
    </ul>
  );
}

/** One dad's week, read-only. */
function BoardEntry({ row, isYou = false }: { row: BoardRow; isYou?: boolean }) {
  const { t } = useT();
  return (
    <li
      className="grid grid-cols-[6.5rem_1fr] gap-2 border-b border-line py-2.5 max-[32rem]:grid-cols-1 max-[32rem]:gap-0"
      data-testid="board-row"
    >
      <span className="font-semibold">
        {row.name}
        {isYou ? t('here.you') : ''}
      </span>
      <span className="grid gap-0.5">
        {row.checkIn ? (
          <span className="text-[0.9375rem]" data-testid="board-rating">
            <strong>{row.checkIn.rating}/5</strong> {ratingWord(t, row.checkIn.rating)}
            {row.checkIn.note ? ` — ${row.checkIn.note}` : ''}
          </span>
        ) : null}
        {row.commitment ? (
          <span
            className={cn(
              'text-[0.9375rem]',
              row.commitment.outcome === 'done' && 'text-accent',
              row.commitment.outcome === 'missed' && 'text-muted line-through',
              row.commitment.outcome === 'pending' && 'text-muted',
            )}
          >
            {outcomeWord(t, row.commitment.outcome)}: {row.commitment.body}
            {row.commitment.reflection ? ` — ${row.commitment.reflection}` : ''}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Your own week: the number, the line, the thing to try — and one Save.
 *
 * It sends only what actually changed. Re-sending a commitment that has not
 * been edited would reset its outcome, because a new promise has not been kept
 * yet; a dad correcting a typo in his note must not quietly un-keep it.
 */
function YourWeek({ row, onSaved }: { row: BoardRow | null; onSaved: () => void }) {
  const { t } = useT();
  const savedRating = row?.checkIn?.rating ?? 0;
  const savedNote = row?.checkIn?.note ?? '';
  const savedCommitment = row?.commitment?.body ?? '';

  const [rating, setRating] = useState(savedRating);
  const [note, setNote] = useState(savedNote);
  const [commitment, setCommitment] = useState(savedCommitment);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRating(row?.checkIn?.rating ?? 0);
    setNote(row?.checkIn?.note ?? '');
    setCommitment(row?.commitment?.body ?? '');
  }, [row]);

  const checkInChanged = rating > 0 && (rating !== savedRating || note.trim() !== savedNote.trim());
  const commitmentChanged =
    commitment.trim() !== '' && commitment.trim() !== savedCommitment.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!checkInChanged && !commitmentChanged) return;
    setBusy(true);
    if (checkInChanged) await saveCheckIn(rating, note).catch(() => {});
    if (commitmentChanged) await saveCommitment(commitment).catch(() => {});
    setBusy(false);
    onSaved();
  }

  return (
    <form className="grid gap-3" data-testid="your-week" onSubmit={submit}>
      <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
        <legend className="mb-1.5 text-sm text-muted">{t('b.how_was')}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className={cn(
              'relative grid h-10 w-10 cursor-pointer place-items-center rounded-app border tabular-nums',
              'transition-colors duration-75',
              rating === n
                ? 'border-accent bg-accent text-on-accent'
                : 'border-edge text-muted hover:border-accent hover:text-accent',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
            )}
          >
            {/* Transparent and filling the label: the input IS the hit area.
                A 0x0 input has no bounding box, which costs it its own click
                target and makes it invisible to anything driving the page. */}
            <input
              type="radio"
              name="rating"
              value={n}
              checked={rating === n}
              onChange={() => setRating(n)}
              className="absolute inset-0 m-0 cursor-pointer opacity-0"
            />
            <span aria-hidden="true">{n}</span>
            <span className="sr-only">
              {n} — {ratingWord(t, n)}
            </span>
          </label>
        ))}
      </fieldset>

      <label htmlFor="note" className="sr-only">
        {t('b.note_label')}
      </label>
      <input
        id="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('b.note_placeholder')}
        maxLength={280}
        className={FIELD}
      />

      <div className="grid gap-1.5">
        <label htmlFor="commitment" className="text-sm text-muted">
          {t('b.commit_label')}
        </label>
        <input
          id="commitment"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          placeholder={t('b.commit_placeholder')}
          maxLength={200}
          className={FIELD}
        />
      </div>

      <Button
        type="submit"
        look="primary"
        className="justify-self-start"
        disabled={busy || (!checkInChanged && !commitmentChanged)}
      >
        <Check size={15} aria-hidden="true" />
        {t('b.save')}
      </Button>
    </form>
  );
}

/** The first thing a new week asks you. */
function HowDidItGo({
  pending,
  onSaved,
}: {
  pending: { week: string; body: string };
  onSaved: () => void;
}) {
  const { t, lang } = useT();
  const [reflection, setReflection] = useState('');
  const [busy, setBusy] = useState(false);

  async function answer(outcome: 'done' | 'missed') {
    setBusy(true);
    await saveCommitmentOutcome(pending.week, outcome, reflection).catch(() => {});
    setBusy(false);
    onSaved();
  }

  return (
    <section
      className="mb-6 rounded-lg border border-line bg-panel p-3"
      data-testid="how-did-it-go"
    >
      <p className="m-0 text-[0.9375rem]">
        {t('b.you_said', {
          week: t('b.week_of', { date: weekDate(pending.week, lang) }),
          body: pending.body,
        })}
      </p>
      <label htmlFor="reflection" className="sr-only">
        {t('b.how_did_it_go')}
      </label>
      <input
        id="reflection"
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        placeholder={t('b.how_did_it_go')}
        maxLength={280}
        className={`${FIELD} mt-2`}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button look="primary" onClick={() => void answer('done')} disabled={busy}>
          <Check size={15} aria-hidden="true" />
          {t('b.did_it')}
        </Button>
        <Button look="quiet" onClick={() => void answer('missed')} disabled={busy}>
          {t('b.didnt')}
        </Button>
      </div>
    </section>
  );
}
