import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  compareMonths,
  dayName,
  dayNameShort,
  monthGrid,
  monthName,
  monthOf,
  shiftMonth,
  weekdayHeadings,
  type Month,
} from '../shared/calendarMonth';
import { fetchPoll, pickDay, setVote, type Answer, type PollState } from './api';
import { plural, useT, type Lang, type T } from './i18n';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { FIELD } from './ui/field';

/** How many days get their own row under the calendar. Enough to see the
 * answer and the runner-up; a list of every day anybody marked is the
 * calendar again, in words. */
const SHORTLIST = 3;

export interface Tally {
  day: string;
  in: number;
  maybe: number;
  /** What the reader himself said, or null if he has not looked at that day —
   * which is a different thing from "can't". */
  mine: Answer | null;
  /** Who can, and who might, by name. Names are what decide it: a man wants
   * to know whether HIS friend is coming, the same as an RSVP. */
  names: { in: string[]; maybe: string[] };
}

/**
 * Everyone's marks, by day.
 *
 * Pure and exported because home shows the leading days and the sheet shows
 * the whole calendar, and both have to agree about which day is winning.
 */
export function talliesOf(poll: PollState, you: string): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const { day, votes } of poll.days) {
    const tally: Tally = { day, in: 0, maybe: 0, mine: null, names: { in: [], maybe: [] } };
    for (const vote of votes) {
      if (vote.memberId === you) tally.mine = vote.answer;
      if (vote.answer === 'in') {
        tally.in += 1;
        tally.names.in.push(vote.name);
      } else if (vote.answer === 'maybe') {
        tally.maybe += 1;
        tally.names.maybe.push(vote.name);
      }
    }
    out.set(day, tally);
  }
  return out;
}

/**
 * The days worth putting up, best first.
 *
 * "Can" outranks "might" outright rather than being weighted against it: a
 * maybe is a man who has not decided, and a day three dads can do beats one
 * that four might. Ties go to the earlier date, because the sooner one is the
 * one they will actually turn up to.
 */
export function bestDays(poll: PollState, you: string, limit = SHORTLIST): Tally[] {
  return [...talliesOf(poll, you).values()]
    .filter((t) => t.in > 0 || t.maybe > 0)
    .sort((a, b) => b.in - a.in || b.maybe - a.maybe || a.day.localeCompare(b.day))
    .slice(0, limit);
}

/** none → can → might → can't → none. One control per day, and a whole cycle
 * in three taps from a standing start. */
function nextAnswer(mine: Answer | null): Answer | null {
  if (mine === null) return 'in';
  if (mine === 'in') return 'maybe';
  if (mine === 'maybe') return 'out';
  return null;
}

/** "3 can, 1 might" — only the parts that are not zero, because "0 might" is
 * the screen reading out the absence of news. */
export function tallyWords(t: T, lang: Lang, tally: Tally | undefined): string {
  if (!tally || (tally.in === 0 && tally.maybe === 0)) return t('p.tally_none');
  return [
    tally.in > 0 ? t(`p.tally_in_${plural(lang, tally.in)}`, { n: tally.in }) : null,
    tally.maybe > 0 ? t(`p.tally_maybe_${plural(lang, tally.maybe)}`, { n: tally.maybe }) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function yoursWords(t: T, mine: Answer | null): string {
  if (mine === null) return t('p.yours_none');
  return t(`p.yours_${mine}`);
}

/**
 * When's the next one.
 *
 * A month at a time, pageable as far forward as anybody wants to look. Every
 * dad marks the days he can do and the day with the most of them on it is the
 * obvious answer — then any dad locks it in, the same way any dad sets the
 * night, and the room says who did.
 *
 * There is no organiser and no deadline. A rule that picked the leader at some
 * hour would be deciding a tie, or a late vote, on behalf of five men who are
 * all in the same conversation and can simply say.
 */
export function Poll({
  you,
  pulse,
  onPicked,
}: {
  /** The reader's own member id. */
  you: string;
  /** Bumped when the room says somebody marked the calendar. */
  pulse: number;
  onPicked: () => void;
}) {
  const { t, lang } = useT();
  const [poll, setPoll] = useState<PollState | null>(null);
  const [month, setMonth] = useState<Month | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPoll()
      .then((next) => !cancelled && setPoll(next))
      .catch(() => {
        // The calendar is everyone's; a failed read leaves what is on the
        // screen rather than replacing it with a wrong empty one.
      });
    return () => {
      cancelled = true;
    };
  }, [pulse]);

  const tallies = useMemo(
    () => (poll ? talliesOf(poll, you) : new Map<string, Tally>()),
    [poll, you],
  );
  const best = useMemo(() => (poll ? bestDays(poll, you) : []), [poll, you]);

  if (poll === null) return <p className="m-0 text-[1.0625rem] text-muted">…</p>;

  const thisMonth = monthOf(poll.today) ?? { year: 1970, month: 1 };
  const showing = month ?? thisMonth;
  const at = time ?? poll.time;

  async function act(work: Promise<PollState>, done?: () => void) {
    setBusy(true);
    setError(null);
    try {
      setPoll(await work);
      done?.();
    } catch {
      setError(t('p.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4" data-testid="poll">
      {/* Said once, above the grid, rather than on thirty cells: a control
          that has to explain itself on every press is a control, but a
          calendar is a calendar and one line is enough. */}
      <p className="m-0 text-[1.0625rem] text-muted">{t('p.how')}</p>

      <div className="grid grid-cols-1 gap-2">
        <div className="flex items-center gap-2">
          <Button
            look="quiet"
            size="icon"
            aria-label={t('p.prev_month')}
            data-testid="poll-prev"
            // Never backwards past the month we are standing in: a day that
            // has gone is not a day anybody can turn up on.
            disabled={compareMonths(showing, thisMonth) <= 0}
            onClick={() => setMonth(shiftMonth(showing, -1))}
          >
            <ChevronLeft size={20} aria-hidden="true" />
            <span className="sr-only">{t('p.prev_month')}</span>
          </Button>
          <h3
            className="m-0 min-w-0 flex-1 text-center text-[1.0625rem] font-semibold"
            data-testid="poll-month"
          >
            {monthName(lang, showing)}
          </h3>
          <Button
            look="quiet"
            size="icon"
            aria-label={t('p.next_month')}
            data-testid="poll-next"
            onClick={() => setMonth(shiftMonth(showing, 1))}
          >
            <ChevronRight size={20} aria-hidden="true" />
            <span className="sr-only">{t('p.next_month')}</span>
          </Button>
        </div>

        <div className="cal" role="group" aria-label={t('p.title')}>
          {weekdayHeadings(lang).map((name) => (
            <span className="cal-head" key={name} aria-hidden="true">
              {name}
            </span>
          ))}
          {monthGrid(showing)
            .flat()
            .map((day, index) =>
              day === null ? (
                // A blank before the 1st or after the last. Keyed by its
                // position, which for a fixed month never moves.
                <span className="cal-pad" key={`pad-${index}`} />
              ) : (
                <Day
                  key={day}
                  day={day}
                  tally={tallies.get(day)}
                  past={day < poll.today}
                  busy={busy}
                  onPress={(answer) => void act(setVote(day, answer))}
                />
              ),
            )}
        </div>
      </div>

      {/* What the calendar says, in words, so nobody has to read a grid to
          find the answer. The count is of dads, and the names are who. */}
      <section className="grid grid-cols-1 gap-2">
        {/* The heading only once there is a list under it. "Most of you can
            do" over "nobody has picked a day yet" is a label for nothing, and
            on a 360px phone it is the row that puts the grid past the fold. */}
        {best.length === 0 ? (
          <p className="m-0 text-[1.0625rem] text-muted" data-testid="poll-nobody">
            {t('p.nobody')}
          </p>
        ) : (
          <h3 className="m-0 text-[1.0625rem] font-semibold text-muted">{t('p.best')}</h3>
        )}
        {best.length === 0 ? null : (
          <ul className="m-0 list-none border-t border-line p-0">
            {best.map((tally) => (
              <li
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line py-2"
                key={tally.day}
                data-testid="poll-best"
                data-day={tally.day}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[1.0625rem]">
                    {dayNameShort(lang, tally.day)}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {[
                      tally.names.in.length > 0
                        ? t('n.in_list', { names: tally.names.in.join(', ') })
                        : null,
                      tally.names.maybe.length > 0
                        ? t('n.maybe_list', { names: tally.names.maybe.join(', ') })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Button
                  look="primary"
                  disabled={busy}
                  aria-label={t('p.lock_day', { day: dayName(lang, tally.day), time: at })}
                  data-testid="poll-lock"
                  onClick={() => void act(pickDay(tally.day, at), onPicked)}
                >
                  <Check size={18} aria-hidden="true" />
                  <span aria-hidden="true">{t('p.lock')}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* The hour, once, under the answer it applies to — and only when
            there is an answer. It is nearly always the hour they already use,
            so it is a thing to change rather than a question to ask, and a
            time field under "nobody has picked a day yet" is a control for a
            decision nobody can make yet. */}
        {best.length === 0 ? null : (
          <div className="flex items-center gap-2">
            <label htmlFor="poll-time" className="text-[1.0625rem] text-muted">
              {t('p.time')}
            </label>
            <input
              id="poll-time"
              type="time"
              value={at}
              onChange={(e) => setTime(e.target.value)}
              // No aria-label: the visible label beside it IS the name. An
              // `aria-label` of "Time" over a label reading "Starts at" is a
              // control whose name does not contain its own words, which is
              // both a WCAG failure and a thing a voice user cannot ask for.
              data-testid="poll-time"
              className={cn(FIELD, 'h-11 w-auto py-0')}
            />
          </div>
        )}
      </section>

      {error ? (
        <p className="error m-0" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One day.
 *
 * A whole cell, because a thumb is 44px and a date is four characters — and
 * because the count of dads who can do it has to sit somewhere a man's eye
 * finds while scanning a month. Everything the cell means is in its
 * accessible name; the marks on it are shorthand for people who can see them.
 */
function Day({
  day,
  tally,
  past,
  busy,
  onPress,
}: {
  day: string;
  tally: Tally | undefined;
  past: boolean;
  busy: boolean;
  onPress: (answer: Answer | null) => void;
}) {
  const { t, lang } = useT();
  const mine = tally?.mine ?? null;
  const number = Number(day.slice(8));

  return (
    <button
      type="button"
      className="cal-day"
      data-day={day}
      data-mine={mine ?? 'none'}
      data-testid="poll-day"
      disabled={past || busy}
      aria-pressed={mine === 'in'}
      aria-label={t('p.cell', {
        day: dayName(lang, day),
        tally: tallyWords(t, lang, tally),
        yours: yoursWords(t, mine),
      })}
      onClick={() => onPress(nextAnswer(mine))}
    >
      {/* No icon for his own answer: the cell itself is filled, ringed or
          struck through, which is three states told apart at arm's length
          without putting a 13px glyph in a corner nobody looks at. The words
          are in the accessible name, where they belong. */}
      <span className="cal-num" aria-hidden="true">
        {number}
      </span>
      {/* The others, as a number. A row of five faces in a 44px cell is five
          things nobody can tell apart; the names are in the list below. */}
      <span className="cal-count" aria-hidden="true">
        {tally && tally.in > 0 ? tally.in : ''}
      </span>
    </button>
  );
}
