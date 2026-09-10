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
import { useT, type Key, type T } from './i18n';

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
 * The week, in public. Every dad has a row whether or not he filled it in —
 * a board that only shows the dads who turned up is a board that flatters.
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

  if (data === 'loading') return <p className="quiet">{t('b.loading')}</p>;
  if (!data) return <p className="quiet">{t('b.failed')}</p>;

  const [thisWeek, ...before] = data.weeks;
  const mine = thisWeek?.rows.find((r) => r.memberId === data.you) ?? null;

  return (
    <div className="board" data-testid="board">
      {data.pending ? <HowDidItGo pending={data.pending} onSaved={reload} /> : null}

      <section>
        <h2>{t('b.this_week')}</h2>
        <YourWeek row={mine} onSaved={reload} />
        {/* Your own row stays in the list, not just in the editor above it:
            the whole feature is group-visible by design, and you should be
            able to read your week in the same words everyone else reads it. */}
        <ul className="board-rows">
          {(thisWeek?.rows ?? []).map((row) => (
            <BoardEntry key={row.memberId} row={row} isYou={row.memberId === data.you} />
          ))}
        </ul>
      </section>

      {/* A week nobody filled in is not a week worth printing: four
          'nothing from anyone' headings is a scroll through an empty diary. */}
      {before
        .filter((w) => w.rows.some((r) => r.checkIn ?? r.commitment))
        .map((w) => {
          const kept = w.rows.filter((r) => r.commitment?.outcome === 'done').length;
          const promised = w.rows.filter((r) => r.commitment).length;
          return (
            <section key={w.week}>
              {/* The follow-through number is the whole point of the week
                behind you, so it stays — as words, not a badge. */}
              <h2>
                {t('b.week_of', { date: weekDate(w.week, lang) })}
                {promised > 0 ? ` · ${t('b.kept_count', { kept, total: promised })}` : ''}
              </h2>
              <ul className="board-rows">
                {w.rows.map((row) => (
                  <BoardEntry key={row.memberId} row={row} isYou={row.memberId === data.you} />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

/** One dad's week, read-only. */
function BoardEntry({ row, isYou = false }: { row: BoardRow; isYou?: boolean }) {
  const { t } = useT();
  const empty = !row.checkIn && !row.commitment;
  return (
    <li className="board-row" data-testid="board-row">
      <span className="board-who">
        {row.name}
        {isYou ? t('here.you') : ''}
      </span>
      {empty ? (
        <span className="quiet">{t('b.nothing_yet')}</span>
      ) : (
        <span className="board-detail">
          {row.checkIn ? (
            <span className="board-rating" data-testid="board-rating">
              <strong>{row.checkIn.rating}/5</strong> {ratingWord(t, row.checkIn.rating)}
              {row.checkIn.note ? ` — ${row.checkIn.note}` : ''}
            </span>
          ) : null}
          {row.commitment ? (
            <span className={`board-commitment is-${row.commitment.outcome}`}>
              {outcomeWord(t, row.commitment.outcome)}: {row.commitment.body}
              {row.commitment.reflection ? ` — ${row.commitment.reflection}` : ''}
            </span>
          ) : null}
        </span>
      )}
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
    <form className="your-week" data-testid="your-week" onSubmit={submit}>
      <fieldset className="rating">
        <legend>{t('b.how_was')}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={rating === n ? 'is-picked' : ''}>
            <input
              type="radio"
              name="rating"
              value={n}
              checked={rating === n}
              onChange={() => setRating(n)}
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
      />

      <label htmlFor="commitment">{t('b.commit_label')}</label>
      <input
        id="commitment"
        value={commitment}
        onChange={(e) => setCommitment(e.target.value)}
        placeholder={t('b.commit_placeholder')}
        maxLength={200}
      />

      <button type="submit" disabled={busy || (!checkInChanged && !commitmentChanged)}>
        {t('b.save')}
      </button>
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
    <section className="how-did-it-go" data-testid="how-did-it-go">
      <p className="prompt-body">
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
      />
      <div className="prompt-actions">
        <button type="button" onClick={() => void answer('done')} disabled={busy}>
          {t('b.did_it')}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => void answer('missed')}
          disabled={busy}
        >
          {t('b.didnt')}
        </button>
      </div>
    </section>
  );
}
