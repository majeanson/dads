import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { weekLabel } from '../shared/week';
import {
  fetchBoard,
  saveCheckIn,
  saveCommitment,
  saveCommitmentOutcome,
  type BoardData,
  type BoardRow,
} from './api';

const RATING_WORDS = ['', 'rough', 'hard', 'alright', 'good', 'great'];

/**
 * The week, in public. Every dad has a row whether or not he filled it in —
 * a board that only shows the dads who turned up is a board that flatters.
 */
export function Board({ onChanged }: { onChanged?: () => void } = {}) {
  const [data, setData] = useState<BoardData | null | 'loading'>('loading');
  const reload = useCallback(() => {
    fetchBoard()
      .then((d) => {
        setData(d);
        // The tab's mark is about this dad's week, which may have just changed.
        onChanged?.();
      })
      .catch(() => setData(null));
  }, [onChanged]);

  useEffect(reload, [reload]);

  if (data === 'loading') return <p className="quiet">Fetching the board…</p>;
  if (!data) return <p className="quiet">Couldn’t load the board.</p>;

  const [thisWeek, ...before] = data.weeks;
  const mine = thisWeek?.rows.find((r) => r.memberId === data.you) ?? null;

  return (
    <div className="board" data-testid="board">
      {data.pending ? <HowDidItGo pending={data.pending} onSaved={reload} /> : null}

      <section>
        <h2>
          This week <span className="count">{weekLabel(data.week)}</span>
        </h2>
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

      {before.map((w) => (
        <section key={w.week}>
          <h2>
            {weekLabel(w.week)}{' '}
            <span className="count">
              {w.rows.filter((r) => r.commitment?.outcome === 'done').length}/
              {w.rows.filter((r) => r.commitment).length} kept
            </span>
          </h2>
          {w.rows.every((r) => !r.checkIn && !r.commitment) ? (
            <p className="quiet">Nothing from anyone.</p>
          ) : (
            <ul className="board-rows">
              {w.rows.map((row) => (
                <BoardEntry key={row.memberId} row={row} isYou={row.memberId === data.you} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** One dad's week, read-only. */
function BoardEntry({ row, isYou = false }: { row: BoardRow; isYou?: boolean }) {
  const empty = !row.checkIn && !row.commitment;
  return (
    <li className="board-row" data-testid="board-row">
      <span className="board-who">
        {row.name}
        {isYou ? ' (you)' : ''}
      </span>
      {empty ? (
        <span className="quiet">— nothing yet</span>
      ) : (
        <span className="board-detail">
          {row.checkIn ? (
            <span className="board-rating" data-testid="board-rating">
              <strong>{row.checkIn.rating}/5</strong> {RATING_WORDS[row.checkIn.rating]}
              {row.checkIn.note ? ` — ${row.checkIn.note}` : ''}
            </span>
          ) : null}
          {row.commitment ? (
            <span className={`board-commitment is-${row.commitment.outcome}`}>
              <span className="badge">
                {row.commitment.outcome === 'done'
                  ? 'kept'
                  : row.commitment.outcome === 'missed'
                    ? 'missed'
                    : 'trying'}
              </span>{' '}
              {row.commitment.body}
              {row.commitment.reflection ? ` — ${row.commitment.reflection}` : ''}
            </span>
          ) : null}
        </span>
      )}
    </li>
  );
}

/** Your own row, editable in place. */
function YourWeek({ row, onSaved }: { row: BoardRow | null; onSaved: () => void }) {
  const [rating, setRating] = useState(row?.checkIn?.rating ?? 0);
  const [note, setNote] = useState(row?.checkIn?.note ?? '');
  const [commitment, setCommitment] = useState(row?.commitment?.body ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRating(row?.checkIn?.rating ?? 0);
    setNote(row?.checkIn?.note ?? '');
    setCommitment(row?.commitment?.body ?? '');
  }, [row]);

  async function submitCheckIn(event: FormEvent) {
    event.preventDefault();
    if (!rating) return;
    setBusy(true);
    await saveCheckIn(rating, note).catch(() => {});
    setBusy(false);
    onSaved();
  }

  async function submitCommitment(event: FormEvent) {
    event.preventDefault();
    if (!commitment.trim()) return;
    setBusy(true);
    await saveCommitment(commitment).catch(() => {});
    setBusy(false);
    onSaved();
  }

  return (
    <div className="your-week" data-testid="your-week">
      <form onSubmit={submitCheckIn}>
        <fieldset className="rating">
          <legend>How was your week?</legend>
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
                {n} — {RATING_WORDS[n]}
              </span>
            </label>
          ))}
        </fieldset>

        <label htmlFor="note" className="sr-only">
          One line about your week
        </label>
        <input
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="One line — the honest version"
          maxLength={280}
        />
        <button type="submit" disabled={busy || !rating}>
          {row?.checkIn ? 'Update' : 'Check in'}
        </button>
      </form>

      <form onSubmit={submitCommitment}>
        <label htmlFor="commitment">One thing to try this week</label>
        <input
          id="commitment"
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          placeholder="Something small and concrete"
          maxLength={200}
        />
        <button type="submit" disabled={busy || !commitment.trim()}>
          {row?.commitment ? 'Change it' : 'Commit'}
        </button>
      </form>
    </div>
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
      <p className="prompt-eyebrow">{weekLabel(pending.week)}</p>
      <p className="prompt-body">You said you’d try: {pending.body}</p>
      <label htmlFor="reflection" className="sr-only">
        How did it go?
      </label>
      <input
        id="reflection"
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        placeholder="How did it go?"
        maxLength={280}
      />
      <div className="prompt-actions">
        <button type="button" onClick={() => void answer('done')} disabled={busy}>
          I did it
        </button>
        <button
          type="button"
          className="link"
          onClick={() => void answer('missed')}
          disabled={busy}
        >
          I didn’t
        </button>
      </div>
    </section>
  );
}
