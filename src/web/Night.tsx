import { CalendarPlus, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  addNightItem,
  fetchNight,
  removeNightItem,
  setRsvp,
  type NightItem,
  type NightState,
  type Rsvp,
} from './api';
import { useT } from './i18n';
import { nightDetail, NightEditor } from './NightEditor';
import { Button } from './ui/Button';
import { FIELD } from './ui/field';
import type { DadNight } from '../shared/dadNight';

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
export function Night({ night, you }: { night: DadNight | null; you: string }) {
  const { t, lang } = useT();
  const [state, setState] = useState<NightState | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="grid gap-5" data-testid="night">
      {night === null ? (
        <p className="m-0 text-[1.0625rem] text-muted">{t('n.none')}</p>
      ) : (
        <>
          <div className="grid gap-3">
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

            <Coming
              answers={state?.answers ?? []}
              you={you}
              busy={busy}
              onAnswer={(coming) => void act(setRsvp(coming))}
            />
          </div>

          <Agenda
            items={state?.items ?? []}
            you={you}
            busy={busy}
            onAdd={(body) => act(addNightItem(body))}
            onRemove={(id) => void act(removeNightItem(id))}
          />
        </>
      )}

      <Change night={night} />
    </div>
  );
}

/** The editor, out of the way until it is wanted. A night with none set is
 * the exception: there, setting one IS the sheet. */
function Change({ night }: { night: DadNight | null }) {
  const { t } = useT();
  const [open, setOpen] = useState(night === null);
  if (!open) {
    return (
      <Button
        look="quiet"
        size="lg"
        className="justify-self-start px-0"
        onClick={() => setOpen(true)}
      >
        <Pencil size={18} aria-hidden="true" />
        {t('n.change')}
      </Button>
    );
  }
  return <NightEditor night={night} onDone={() => {}} />;
}

/** Two buttons and the names of everyone who has pressed one. */
function Coming({
  answers,
  you,
  busy,
  onAnswer,
}: {
  answers: Rsvp[];
  you: string;
  busy: boolean;
  onAnswer: (coming: boolean) => void;
}) {
  const { t } = useT();
  const mine = answers.find((a) => a.memberId === you) ?? null;
  const coming = answers.filter((a) => a.coming);
  const not = answers.filter((a) => !a.coming);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          look={mine?.coming === true ? 'primary' : 'plain'}
          size="lg"
          disabled={busy}
          onClick={() => onAnswer(true)}
          data-testid="rsvp-in"
        >
          <Check size={18} aria-hidden="true" />
          {t('n.im_in')}
        </Button>
        <Button
          look={mine?.coming === false ? 'danger' : 'plain'}
          size="lg"
          disabled={busy}
          onClick={() => onAnswer(false)}
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
