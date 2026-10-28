import { CalendarPlus, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { repeats, weekdayOf, type DadNight } from '../shared/dadNight';
import { EVENT_PLACE_MAX, EVENT_TITLE_MAX } from '../shared/events';
import {
  addEvent,
  answerEvent,
  cancelEvent,
  editEvent,
  fetchEvents,
  type Answer,
  type EventInput,
  type EventsState,
  type GroupEvent,
} from './api';
import { Answers } from './Answers';
import { useT, type Key, type T } from './i18n';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { FIELD } from './ui/field';

const DEFAULT_TIME = '19:00';

/**
 * A label and its field. `grid-cols-1` is `minmax(0, 1fr)`: a label with no
 * column template gets an implicit `auto` one, which takes the width of
 * whatever is inside it — and a native date or time picker on iOS has a width
 * of its own.
 */
const LABEL = 'grid grid-cols-1 min-w-0 gap-1.5 text-[1.0625rem]';

/**
 * The native pickers. iOS draws them with its own intrinsic width and ignores
 * `width: 100%` until the native look is switched off; they also centre their
 * text there, so it is put back.
 */
const PICKER = cn(FIELD, 'block min-w-0 max-w-full appearance-none text-left');

/** The server's word for why, as a sentence. */
const REFUSED: Record<string, Key> = {
  empty: 'ev.err_empty',
  bad_day: 'ev.err_day',
  bad_time: 'ev.err_time',
  past: 'ev.err_past',
  full: 'ev.err_full',
  too_long: 'ev.err_too_long',
};

/** A form in progress. `id` is set when it is an event being changed. */
interface Draft extends EventInput {
  id?: string;
}

/**
 * Whether dad night falls on `day`, for the calendar.
 *
 * A standing night is every one of its weekdays from today on; an arranged
 * one is its date. A passed one-off is nothing: the calendar shows what is
 * still to come, the same test as everywhere else (`stillToCome`).
 */
function nightOn(night: DadNight | null, day: string, today: string): boolean {
  if (night === null || day < today) return false;
  return repeats(night) ? weekdayOf(day) === night.weekday : night.date === day;
}

/**
 * Every night but the dad one.
 *
 * Dad night is a standing mechanism with its own sheet and stays one. This is
 * for the things that happen ONCE — the bowling, the barbecue, the game — on a
 * date somebody has to put somewhere. The month shows both, so a man planning
 * the bowling can see he is about to put it on top of Thursday.
 *
 * Any dad puts one up; only the dad who did changes or cancels it. Answering
 * is the night's three answers, and nothing is said in the conversation.
 */
export function Events({
  night,
  you,
  pulse,
}: {
  night: DadNight | null;
  /** The reader's own member id. */
  you: string;
  /** Bumped when the room says an event changed. */
  pulse: number;
}) {
  const { t, lang } = useT();
  const [state, setState] = useState<EventsState | null>(null);
  const [month, setMonth] = useState<Month | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Bumped whenever a form is opened or pointed at something, so it can take
  // focus and scroll into view without the keyboard coming up.
  const [focusKey, setFocusKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEvents()
      .then((next) => !cancelled && setState(next))
      .catch(() => {
        // The list is everyone's; a failed read leaves what is on the screen
        // rather than replacing it with a wrong empty one.
      });
    return () => {
      cancelled = true;
    };
  }, [pulse]);

  const byDay = useMemo(() => {
    const map = new Map<string, GroupEvent[]>();
    for (const event of state?.events ?? []) {
      map.set(event.day, [...(map.get(event.day) ?? []), event]);
    }
    return map;
  }, [state]);

  if (state === null) return <p className="m-0 text-[1.0625rem] text-muted">…</p>;

  const today = state.today;
  const thisMonth = monthOf(today) ?? { year: 1970, month: 1 };
  const showing = month ?? thisMonth;

  async function act(work: Promise<EventsState>, done?: () => void) {
    setBusy(true);
    setError(null);
    try {
      setState(await work);
      done?.();
    } catch (err) {
      const key = REFUSED[err instanceof Error ? err.message : ''];
      setError(key ? t(key) : t('ev.failed'));
    } finally {
      setBusy(false);
    }
  }

  function plan(day: string) {
    setError(null);
    setFocusKey((k) => k + 1);
    // A day picked while a form is open moves the form, whatever is in it.
    setDraft((d) => (d ? { ...d, day } : { title: '', place: '', day, time: DEFAULT_TIME }));
  }

  return (
    <div className="grid grid-cols-1 gap-4" data-testid="events">
      <p className="m-0 text-[1.0625rem] text-muted">{t('ev.how')}</p>

      <ul className="cal-key" aria-label={t('ev.title')}>
        <li>
          <span className="cal-swatch" data-night="" aria-hidden="true" />
          {t('ev.legend_night')}
        </li>
        <li>
          <span className="cal-swatch" data-event="" aria-hidden="true" />
          {t('ev.legend_event')}
        </li>
        <li>
          <span className="cal-swatch" data-today="" aria-hidden="true" />
          {t('p.legend_today')}
        </li>
      </ul>

      <div className="grid grid-cols-1 gap-2">
        <div className="flex items-center gap-2">
          <Button
            look="quiet"
            size="icon"
            aria-label={t('p.prev_month')}
            data-testid="ev-prev"
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
            data-testid="ev-month"
          >
            {monthName(lang, showing)}
          </h3>
          <Button
            look="quiet"
            size="icon"
            aria-label={t('p.next_month')}
            data-testid="ev-next"
            onClick={() => setMonth(shiftMonth(showing, 1))}
          >
            <ChevronRight size={20} aria-hidden="true" />
            <span className="sr-only">{t('p.next_month')}</span>
          </Button>
        </div>

        <div className="cal" role="group" aria-label={t('ev.title')}>
          {weekdayHeadings(lang).map((name) => (
            <span className="cal-head" key={name} aria-hidden="true">
              {name}
            </span>
          ))}
          {monthGrid(showing)
            .flat()
            .map((day, index) =>
              day === null ? (
                <span className="cal-pad" key={`pad-${index}`} />
              ) : (
                <DayCell
                  key={day}
                  day={day}
                  today={today}
                  isNight={nightOn(night, day, today)}
                  events={byDay.get(day) ?? []}
                  picked={draft?.day === day}
                  onPress={() => plan(day)}
                />
              ),
            )}
        </div>
      </div>

      {draft ? (
        <Form
          draft={draft}
          focusKey={focusKey}
          today={today}
          busy={busy}
          onChange={setDraft}
          onDone={() => setDraft(null)}
          onSave={(d) => {
            const { id, ...input } = d;
            void act(id ? editEvent(id, input) : addEvent(input), () => setDraft(null));
          }}
        />
      ) : (
        <Button
          look="primary"
          size="lg"
          data-testid="ev-plan"
          onClick={() => plan(today)}
          className="justify-self-start"
        >
          <CalendarPlus size={20} aria-hidden="true" />
          {t('ev.plan')}
        </Button>
      )}

      {error ? (
        <p className="error m-0" role="alert">
          {error}
        </p>
      ) : null}

      <section className="grid grid-cols-1 gap-3" aria-label={t('ev.coming_up')}>
        <h3 className="m-0 text-[1.0625rem] font-semibold text-muted">{t('ev.coming_up')}</h3>
        {state.events.length === 0 ? (
          <p className="m-0 text-[1.0625rem] text-muted" data-testid="ev-nothing">
            {t('ev.nothing')}
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0">
            {state.events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                you={you}
                busy={busy}
                onAnswer={(answer) => void act(answerEvent(event.id, answer))}
                onEdit={() => {
                  setFocusKey((k) => k + 1);
                  setDraft({
                    id: event.id,
                    title: event.title,
                    place: event.place,
                    day: event.day,
                    time: event.time,
                  });
                }}
                onCancel={() => act(cancelEvent(event.id))}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One day. A whole cell, as on the poll: a thumb is 44px. What is on it is in
 * the accessible name; the ring and the dot are shorthand for those who can
 * see them.
 */
function DayCell({
  day,
  today,
  isNight,
  events,
  picked,
  onPress,
}: {
  day: string;
  today: string;
  isNight: boolean;
  events: GroupEvent[];
  picked: boolean;
  onPress: () => void;
}) {
  const { t, lang } = useT();
  const what = [isNight ? t('ev.night') : null, ...events.map((e) => e.title)]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className="cal-day"
      data-day={day}
      data-night={isNight ? '' : undefined}
      data-event={events.length > 0 ? '' : undefined}
      data-picked={picked ? '' : undefined}
      data-today={day === today ? '' : undefined}
      data-testid="ev-day"
      disabled={day < today}
      aria-pressed={picked}
      aria-label={
        t('ev.cell', { day: dayName(lang, day), what: what || t('ev.cell_nothing') }) +
        (day === today ? t('p.cell_today') : '')
      }
      onClick={onPress}
    >
      <span className="cal-num" aria-hidden="true">
        {Number(day.slice(8))}
      </span>
    </button>
  );
}

/** Making one, or changing one. Every field has a visible label. */
function Form({
  draft,
  focusKey,
  today,
  busy,
  onChange,
  onDone,
  onSave,
}: {
  draft: Draft;
  focusKey: number;
  today: string;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onDone: () => void;
  onSave: (draft: Draft) => void;
}) {
  const { t } = useT();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const card = useRef<HTMLFormElement>(null);

  // The card takes focus, not the title: a field would bring the keyboard up
  // over the very thing he just tapped. It is scrolled into view instead, so
  // a form that opens below the fold is not opened out of sight.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
    card.current?.scrollIntoView({ block: 'nearest' });
  }, [focusKey]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.title.trim()) onSave(draft);
  }

  return (
    <form
      ref={card}
      tabIndex={-1}
      className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] bg-[var(--bg-soft)] p-4 outline-none"
      onSubmit={submit}
      data-testid="ev-form"
    >
      <label className={LABEL}>
        {t('ev.f_title')}
        <input
          className={FIELD}
          value={draft.title}
          maxLength={EVENT_TITLE_MAX}
          placeholder={t('ev.f_title_hint')}
          onChange={(e) => set({ title: e.target.value })}
          data-testid="ev-title"
        />
      </label>
      <label className={LABEL}>
        {t('ev.f_place')}
        <input
          className={FIELD}
          value={draft.place}
          maxLength={EVENT_PLACE_MAX}
          onChange={(e) => set({ place: e.target.value })}
          data-testid="ev-place"
        />
      </label>
      {/* One under the other on a phone: two native pickers side by side are
          wider than half a 390px sheet, in French especially, and ran into
          each other. */}
      <div className="grid grid-cols-1 gap-3 min-[30rem]:grid-cols-2">
        <label className={LABEL}>
          {t('ev.f_day')}
          <input
            type="date"
            className={PICKER}
            value={draft.day}
            min={today}
            onChange={(e) => set({ day: e.target.value })}
            data-testid="ev-day-field"
          />
        </label>
        <label className={LABEL}>
          {t('ev.f_time')}
          <input
            type="time"
            className={PICKER}
            value={draft.time}
            onChange={(e) => set({ time: e.target.value })}
            data-testid="ev-time"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          look="primary"
          size="lg"
          disabled={busy || !draft.title.trim()}
          data-testid="ev-save"
        >
          {draft.id ? t('ev.save') : t('ev.put_up')}
        </Button>
        <Button type="button" look="quiet" size="lg" onClick={onDone}>
          {t('ev.never_mind')}
        </Button>
      </div>
    </form>
  );
}

/** Who said what, one line per answer, in names. */
function who(t: T, event: GroupEvent) {
  return (
    [
      ['in', 'n.in_list'],
      ['maybe', 'n.maybe_list'],
      ['out', 'n.out_list'],
    ] as const
  )
    .map(([answer, key]) => {
      const names = event.answers.filter((a) => a.answer === answer).map((a) => a.name);
      return names.length > 0 ? { answer, text: t(key, { names: names.join(', ') }) } : null;
    })
    .filter((line) => line !== null);
}

function EventCard({
  event,
  you,
  busy,
  onAnswer,
  onEdit,
  onCancel,
}: {
  event: GroupEvent;
  you: string;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
  onEdit: () => void;
  onCancel: () => Promise<void>;
}) {
  const { t, lang } = useT();
  const [armed, setArmed] = useState(false);
  const mine = event.answers.find((a) => a.memberId === you)?.answer ?? null;
  const lines = who(t, event);

  return (
    <li
      className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-line p-4"
      data-testid="event"
      data-id={event.id}
    >
      <div className="grid min-w-0 gap-0.5">
        <h4 className="display m-0 min-w-0 break-words text-xl">{event.title}</h4>
        <span className="text-[1.0625rem]">
          {dayNameShort(lang, event.day)} · {event.time}
        </span>
        {event.place ? <span className="text-[1.0625rem] text-muted">{event.place}</span> : null}
        <span className="text-sm text-muted">{t('ev.by', { name: event.name })}</span>
      </div>

      <Answers
        label={t('ev.answer', { title: event.title })}
        mine={mine}
        busy={busy}
        onAnswer={onAnswer}
        ids={{ in: 'ev-in', maybe: 'ev-maybe', out: 'ev-out' }}
      />

      {lines.length === 0 ? null : (
        <div className="grid gap-1 text-[1.0625rem]" data-testid="ev-who">
          {lines.map((line) => (
            <span key={line.answer} className={cn(line.answer === 'out' && 'text-muted')}>
              {line.text}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/event.ics?id=${encodeURIComponent(event.id)}`}
          className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] border border-edge text-muted no-underline transition-colors duration-75 hover:border-accent hover:text-accent"
          title={t('ev.ics')}
          data-testid="ev-ics"
        >
          <CalendarPlus size={20} aria-hidden="true" />
          <span className="sr-only">{t('ev.ics')}</span>
        </a>

        {event.memberId === you ? (
          <>
            <Button look="quiet" onClick={onEdit} data-testid="ev-edit">
              <Pencil size={18} aria-hidden="true" />
              {t('ev.edit')}
            </Button>
            {/* ARMED, like taking a line back: four other men are planning
                around it, so it should not go on one stray tap. */}
            <Button
              look={armed ? 'danger' : 'quiet'}
              disabled={busy}
              onClick={() => {
                if (!armed) setArmed(true);
                else void onCancel();
              }}
              data-testid="ev-cancel"
            >
              <Trash2 size={18} aria-hidden="true" />
              {armed ? t('ev.cancel_sure') : t('ev.cancel')}
            </Button>
          </>
        ) : null}
      </div>
      {armed ? <p className="quiet m-0">{t('ev.cancel_hint')}</p> : null}
    </li>
  );
}
