import { parseDay } from '../shared/dadNight';
import type { PollState } from './api';
import { FaceStack } from './Face';
import { useT } from './i18n';
import { bestDays, tallyWords } from './Poll';

/**
 * "When's the next one?", answered on home: the days the most dads can do,
 * one to a line.
 *
 * It was one sentence — "3 can — Thu, Oct 2 · 2 can — Sat, Oct 4" — which
 * was the answer written as a footnote. Each day is a leaf off a tear-off
 * calendar now: the month small, the date big in the display face, then
 * the weekday, how many can, and the faces of the men who can, glasses
 * down. The one in the lead gets the accent; the runner-up is the same leaf
 * in ink. Two, not the sheet's three: home has to fit a 667px phone with
 * the door and four rows under it, and the answer and the one behind it
 * are what a man needs to see from the kitchen.
 *
 * Not buttons. The calendar is one press away on the button under these,
 * and a row that looked pressable and did the same thing would be two
 * controls for one question.
 */
export function NextDays({ poll, you }: { poll: PollState; you: string }) {
  const { t, lang } = useT();
  const best = bestDays(poll, you, 2);

  if (best.length === 0) {
    return (
      <div className="home-next-none" data-testid="home-poll-none">
        {/* The empty leaf: a date nobody has written on yet. */}
        <span className="home-leaf" data-empty="yes" aria-hidden="true">
          <span className="home-leaf-month">&nbsp;</span>
          <span className="home-leaf-date display">?</span>
        </span>
        <p className="m-0 min-w-0 text-[1.0625rem] text-muted">{t('p.nobody')}</p>
      </div>
    );
  }

  return (
    <ol className="home-next" data-testid="home-poll-best">
      {best.map((tally, i) => {
        const when = leaf(lang, tally.day);
        const can =
          poll.days
            .find((d) => d.day === tally.day)
            ?.votes.filter((v) => v.answer === 'in')
            .map((v) => ({ memberId: v.memberId, shades: true })) ?? [];
        return (
          <li
            key={tally.day}
            className="home-next-day motion-rise"
            data-lead={i === 0 ? 'yes' : undefined}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="home-leaf" aria-hidden="true">
              <span className="home-leaf-month">{when.month}</span>
              <span className="home-leaf-date display">{when.date}</span>
            </span>
            <span className="grid min-w-0">
              {/* The whole date in words for anything reading it aloud; the
                  leaf beside it is a picture of the same thing. */}
              <span className="home-next-weekday truncate">
                {when.weekday}
                <span className="sr-only"> {when.full}</span>
              </span>
              <span className="home-next-tally truncate">{tallyWords(t, lang, tally)}</span>
            </span>
            {can.length > 0 ? (
              <FaceStack people={can} size={26} max={3} ring="var(--bg)" className="ml-auto" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A civil day as a calendar leaf: "sept.", "25", "Thursday". */
function leaf(lang: string, day: string) {
  const parts = parseDay(day);
  if (parts === null) return { month: '', date: day, weekday: day, full: day };
  const at = Date.UTC(parts.year, parts.month - 1, parts.day);
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(lang, { ...o, timeZone: 'UTC' }).format(at);
  return {
    month: f({ month: 'short' }),
    date: String(parts.day),
    weekday: f({ weekday: 'long' }),
    full: f({ day: 'numeric', month: 'long' }),
  };
}
