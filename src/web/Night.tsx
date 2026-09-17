import { CalendarPlus, CalendarX, Check, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  addNightItem,
  fetchNight,
  removeNightItem,
  setNight as saveNight,
  setRsvp,
  type Answer,
  type NightItem,
  type NightState,
  type Rsvp,
} from './api';
import { useT } from './i18n';
import { nightDetail, NightEditor } from './NightEditor';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { Switch } from './ui/Switch';
import { FIELD } from './ui/field';
import { Poll } from './Poll';
import { civilDayIn, nextStart, repeats, stillToCome, type DadNight } from '../shared/dadNight';

const EMPTY: NightState = { occurrence: null, answers: [], items: [] };

/**
 * Everything about the standing night, in one place.
 *
 * The slot got the dads to the table and never said what they were there to
 * talk about, so an evening became whatever the loudest of them brought up.
 * This is the week's answer to that: when it is, who is coming, and the list
 * of things anybody thought of between now and then. On the night, that list
 * is the conversation.
 *
 * Changing the night lives here too rather than in Settings. Settings is for
 * the things a dad sets once; the night is something the group keeps
 * deciding, and it belongs beside the answer to it.
 */
export function Night({
  night,
  you,
  pollPulse,
}: {
  night: DadNight | null;
  you: string;
  /** Bumped when the room says somebody marked the calendar. */
  pollPulse: number;
}) {
  const { t, lang } = useT();
  const [state, setState] = useState<NightState | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  /** Whether the standing-night form is open. Held here rather than in
   * `Change`, because with nothing on the books it has to take the calendar's
   * place and a child cannot hide its own sibling. */
  const [standing, setStanding] = useState(false);

  /** Is there an evening to come, or is the question when the next one is?
   * A night arranged for one evening is still in the group's row the morning
   * after, so `night === null` stopped being the test. */
  const upcoming = stillToCome(night, now);

  useEffect(() => {
    let cancelled = false;
    fetchNight()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState(EMPTY));
    return () => {
      cancelled = true;
    };
  }, [night]);

  async function act(work: Promise<NightState>) {
    setBusy(true);
    try {
      setState(await work);
    } catch {
      // The room is the record; a failed press leaves the sheet as it was.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5" data-testid="night">
      {!upcoming || night === null ? (
        /*
         * Nothing on the books, so this sheet is the calendar.
         *
         * Not "no dad night yet" and a form: the question is when the next one
         * is, and five men answering it together is the answer. The standing
         * night is still available, under it, for a group that wants one —
         * and while that form is open the calendar goes away, because they
         * are two answers to one question and only one of them is being
         * given.
         */
        standing ? null : (
          <Poll you={you} pulse={pollPulse} onPicked={() => {}} />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3">
            <p className="m-0 flex items-center gap-3 text-[1.125rem]" data-testid="night-when">
              <span className="min-w-0 flex-1">{nightDetail(t, lang, night, Date.now())}</span>
              {/* The countdown only reaches a dad who has opened the room. His
                  own calendar reaches him on Thursday afternoon, where the
                  decision actually gets made. */}
              <a
                href="/api/night.ics"
                className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] border border-edge text-muted no-underline transition-colors duration-75 hover:border-accent hover:text-accent"
                title={t('n.calendar')}
                data-testid="night-ics"
              >
                <CalendarPlus size={20} aria-hidden="true" />
                <span className="sr-only">{t('n.calendar')}</span>
              </a>
            </p>

            {/*
             * Always the same day, or arranged one evening at a time.
             *
             * One switch, and it is the whole difference between the two
             * halves of this feature. On, and the night is a standing slot
             * that never needs deciding again. Off, and THIS evening still
             * happens — it is pinned to the date it was already going to fall
             * on — and when it is over the group is asked when the next one
             * is. Nothing is lost either way, which is what makes it safe to
             * flip in a sheet with no confirmation.
             */}
            <Repeat night={night} busy={busy} />

            <Coming
              answers={state?.answers ?? []}
              you={you}
              busy={busy}
              onAnswer={(answer) => void act(setRsvp(answer))}
            />
          </div>

          <Agenda
            items={state?.items ?? []}
            you={you}
            busy={busy}
            onAdd={(body) => act(addNightItem(body))}
            onRemove={(id) => void act(removeNightItem(id))}
          />

          {/* Only an ARRANGED evening can be called off. A standing night is
              not cancelled, it is changed or cleared, and that is what the
              editor below is for. */}
          {/* Not through `act`: what comes back is the group's night, not the
              night's state, and the room pushes it to every open phone — this
              sheet included — the moment it lands. */}
          {repeats(night) ? null : <CallOff busy={busy} onOff={() => saveNight(null)} />}
        </>
      )}

      <Change
        night={night}
        upcoming={upcoming}
        open={standing}
        onOpen={() => setStanding(true)}
        onDone={() => setStanding(false)}
      />
    </div>
  );
}

/**
 * Calling off an evening the group had arranged.
 *
 * Without this the sheet was a dead end: an evening pinned to a date could be
 * turned into a standing weekly night or wiped from a form labelled about
 * something else, and neither of those is what a man means when he says he
 * cannot do Thursday any more. The group was stuck with a date nobody could
 * move until it had been and gone.
 *
 * ARMED, like taking a line back, and for the same reason: four other men
 * arranged their week around this, so it should not go on one stray tap. The
 * second press says it out loud in the room — which evening, and by whom —
 * and the sheet becomes the calendar again in the same breath, because "when
 * is the next one" is the question that follows and the answer is already on
 * the screen.
 */
function CallOff({ busy, onOff }: { busy: boolean; onOff: () => Promise<void> }) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);
  const [going, setGoing] = useState(false);
  const [failed, setFailed] = useState(false);

  async function off() {
    setGoing(true);
    setFailed(false);
    try {
      await onOff();
    } catch {
      // The evening is still on, so say nothing false: he presses again.
      setFailed(true);
      setArmed(false);
    } finally {
      setGoing(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-1">
      <Button
        look={armed ? 'primary' : 'quiet'}
        size="lg"
        disabled={busy || going}
        className={cn('max-w-full justify-self-start', armed ? '' : 'px-0')}
        data-testid="night-call-off"
        onClick={() => (armed ? void off() : setArmed(true))}
      >
        <CalendarX size={18} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 truncate">{armed ? t('n.call_off_sure') : t('n.call_off')}</span>
      </Button>
      {armed ? <p className="m-0 text-sm text-muted">{t('n.call_off_hint')}</p> : null}
      {failed ? (
        <p className="error m-0 text-sm" role="alert">
          {t('n.save_failed')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The standing night, out of the way until it is wanted.
 *
 * Collapsed in both states now, and for two different reasons. With a night
 * on the books it is a thing a dad occasionally changes, so the editor opens
 * under the evening it is about. With none, the sheet above it is the
 * calendar — and the form replaces it rather than joining it, because a
 * weekly slot and a day everyone voted for are two answers to one question.
 *
 * The open/closed state lives in `Night` for that reason: this component
 * cannot hide something that is not its own child.
 */
function Change({
  night,
  upcoming,
  open,
  onOpen,
  onDone,
}: {
  night: DadNight | null;
  upcoming: boolean;
  open: boolean;
  onOpen: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  if (!open) {
    return (
      <Button
        look="quiet"
        size="lg"
        // A Button never wraps, and "Ou reviens à la même soirée chaque
        // semaine" is wider than a 360px phone: without `max-w-full` and a
        // truncating label it made the whole sheet — grid, form and all —
        // wider than the screen it sits in.
        className="max-w-full justify-self-start px-0"
        data-testid="night-standing"
        onClick={onOpen}
      >
        <Pencil size={18} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 truncate">{upcoming ? t('n.change') : t('p.standing')}</span>
      </Button>
    );
  }
  return <NightEditor night={upcoming ? night : null} onDone={onDone} />;
}

/**
 * Always the same day, or one evening at a time.
 *
 * Turning it OFF does not cancel anything: the night is pinned to the date it
 * was already going to fall on, so the group keeps the evening it had and
 * only loses the one after it — which is the whole point, because the one
 * after it is what they want to decide together. Turning it back ON makes
 * that date's weekday the standing one.
 *
 * Any dad may, like the night itself and the three switches. It goes through
 * the same route the editor uses, so the room announces it by name.
 */
function Repeat({ night, busy }: { night: DadNight; busy: boolean }) {
  const { t } = useT();
  const [saving, setSaving] = useState(false);
  const on = repeats(night);

  async function flip(next: boolean) {
    setSaving(true);
    try {
      if (next) {
        // Back to a standing night, on the weekday the arranged one fell on.
        await saveNight({ weekday: night.weekday, time: night.time, tz: null });
      } else {
        // Pin it to the evening it was already going to be. Computed here
        // rather than on the server because the client has the same pure
        // clock and the server has no business guessing what "this one" means.
        const start = nextStart(night, Date.now());
        if (start === null) return;
        await saveNight({
          weekday: night.weekday,
          time: night.time,
          tz: null,
          date: civilDayIn(start, night.tz),
        });
      }
    } catch {
      // The switch snaps back on the next `night` frame, which is the truth.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-1">
      {/* The kit's own row: the whole line is the control, because a 48px
          switch beside a full-width word is a target most thumbs miss. */}
      <Switch
        checked={on}
        label={t('n.repeat')}
        disabled={busy || saving}
        onChange={(next) => void flip(next)}
        testId="night-repeat"
      />
      {/* Only when it is off. A switch that is on is a night everybody
          already understands; a switch that is off has a consequence, and the
          consequence happens hours after the press. */}
      {on ? null : <p className="m-0 text-sm text-muted">{t('n.repeat_off')}</p>}
    </div>
  );
}

/** Three buttons and the names of everyone who has pressed one. */
function Coming({
  answers,
  you,
  busy,
  onAnswer,
}: {
  answers: Rsvp[];
  you: string;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
}) {
  const { t } = useT();
  const mine = answers.find((a) => a.memberId === you)?.answer ?? null;
  const coming = answers.filter((a) => a.answer === 'in');
  const might = answers.filter((a) => a.answer === 'maybe');
  const not = answers.filter((a) => a.answer === 'out');

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          look={mine === 'in' ? 'primary' : 'plain'}
          size="lg"
          disabled={busy}
          aria-pressed={mine === 'in'}
          onClick={() => onAnswer('in')}
          data-testid="rsvp-in"
        >
          <Check size={18} aria-hidden="true" />
          {t('n.im_in')}
        </Button>
        <Button
          look={mine === 'maybe' ? 'primary' : 'plain'}
          size="lg"
          disabled={busy}
          aria-pressed={mine === 'maybe'}
          onClick={() => onAnswer('maybe')}
          data-testid="rsvp-maybe"
        >
          <Minus size={18} aria-hidden="true" />
          {t('n.maybe')}
        </Button>
        <Button
          look={mine === 'out' ? 'danger' : 'plain'}
          size="lg"
          disabled={busy}
          aria-pressed={mine === 'out'}
          onClick={() => onAnswer('out')}
          data-testid="rsvp-out"
        >
          <X size={18} aria-hidden="true" />
          {t('n.cant')}
        </Button>
      </div>

      {/* Names, not a count. "3 coming" is a number a man reads as a quorum;
          the names tell him whether HIS friend is coming, which is the thing
          that actually decides it. */}
      {answers.length === 0 ? null : (
        <p className="m-0 text-[1.0625rem] text-muted" data-testid="rsvp-who">
          {[
            coming.length > 0
              ? t('n.in_list', { names: coming.map((a) => a.name).join(', ') })
              : '',
            might.length > 0
              ? t('n.maybe_list', { names: might.map((a) => a.name).join(', ') })
              : '',
            not.length > 0 ? t('n.out_list', { names: not.map((a) => a.name).join(', ') }) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </>
  );
}

/**
 * What we should get into.
 *
 * The whole point of writing it down on Tuesday is that it survives to
 * Thursday. Each line carries the name of the man who put it up, because on
 * the night somebody has to start, and "Marc wanted to ask about bedtime" is
 * how that happens without anyone having to volunteer.
 */
function Agenda({
  items,
  you,
  busy,
  onAdd,
  onRemove,
}: {
  items: NightItem[];
  you: string;
  busy: boolean;
  onAdd: (body: string) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    await onAdd(body);
  }

  return (
    <section data-testid="agenda">
      <h2 className="mb-2 text-[1.0625rem] font-semibold text-muted">{t('n.agenda')}</h2>

      {items.length === 0 ? null : (
        <ul className="m-0 mb-2 list-none border-t border-line p-0">
          {items.map((item) => (
            <li
              className="flex items-center gap-2 border-b border-line py-2"
              key={item.id}
              data-testid="agenda-item"
            >
              <span className="min-w-0 flex-1 text-[1.0625rem]">
                {item.body} <span className="text-muted">— {item.name}</span>
              </span>
              {/* Only your own, and the server enforces it too. */}
              {item.memberId === you ? (
                <Button
                  look="danger"
                  size="icon"
                  disabled={busy}
                  onClick={() => onRemove(item.id)}
                  aria-label={t('n.agenda_remove')}
                >
                  <Trash2 size={18} aria-hidden="true" />
                  <span className="sr-only">{t('n.agenda_remove')}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form className="flex gap-2" onSubmit={submit}>
        <label htmlFor="night-item" className="sr-only">
          {t('n.agenda_add')}
        </label>
        <input
          id="night-item"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('n.agenda_placeholder')}
          maxLength={200}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <Button type="submit" look="primary" size="lg" disabled={busy || draft.trim() === ''}>
          <Plus size={18} aria-hidden="true" />
          {t('n.agenda_add')}
        </Button>
      </form>
    </section>
  );
}
