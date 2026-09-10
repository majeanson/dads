import { CalendarPlus, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchRsvps, setRsvp, type Rsvp } from './api';
import { useT } from './i18n';
import { nightItem, NightEditor } from './NightEditor';
import { Button } from './ui/Button';
import type { DadNight } from '../shared/dadNight';

/**
 * Everything about the standing night, in one place.
 *
 * The slot was always the mechanism — a night everybody knows about, announced
 * and summarised in the room. What it never answered is the question a man
 * actually asks himself on Thursday afternoon: is anyone else going to be
 * there? So this is when, who has said yes, and the two buttons that say it.
 *
 * Changing the night lives here too rather than in Settings. Settings is for
 * the things a dad sets once; the night is something the group keeps
 * deciding, and it belongs beside the answer to it.
 */
export function Night({ night, you }: { night: DadNight | null; you: string }) {
  const { t, lang } = useT();
  const [answers, setAnswers] = useState<Rsvp[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRsvps()
      .then((s) => !cancelled && setAnswers(s.answers))
      .catch(() => !cancelled && setAnswers([]));
    return () => {
      cancelled = true;
    };
  }, [night]);

  async function answer(coming: boolean) {
    setBusy(true);
    try {
      setAnswers((await setRsvp(coming)).answers);
    } catch {
      // The room is the record; a failed press leaves the buttons as they were.
    } finally {
      setBusy(false);
    }
  }

  const mine = answers?.find((a) => a.memberId === you) ?? null;
  const coming = (answers ?? []).filter((a) => a.coming);
  const not = (answers ?? []).filter((a) => !a.coming);

  return (
    <div className="grid gap-5" data-testid="night">
      {night === null ? (
        <p className="m-0 text-[0.9375rem] text-muted">{t('n.none')}</p>
      ) : (
        <div className="grid gap-3">
          <p className="m-0 text-[0.9375rem]" data-testid="night-when">
            {nightItem(t, lang, night, Date.now())}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              look={mine?.coming === true ? 'primary' : 'plain'}
              disabled={busy}
              onClick={() => void answer(true)}
              data-testid="rsvp-in"
            >
              <Check size={15} aria-hidden="true" />
              {t('n.im_in')}
            </Button>
            <Button
              look={mine?.coming === false ? 'danger' : 'plain'}
              disabled={busy}
              onClick={() => void answer(false)}
              data-testid="rsvp-out"
            >
              <X size={15} aria-hidden="true" />
              {t('n.cant')}
            </Button>
          </div>

          {/* Names, not a count. "3 coming" is a number a man reads as a
              quorum; the names are what tell him whether HIS friend is
              coming, which is the thing that decides it. */}
          <p className="m-0 text-[0.9375rem] text-muted" data-testid="rsvp-who">
            {coming.length === 0 && not.length === 0
              ? t('n.nobody_yet')
              : [
                  coming.length > 0
                    ? t('n.in_list', { names: coming.map((a) => a.name).join(', ') })
                    : '',
                  not.length > 0
                    ? t('n.out_list', { names: not.map((a) => a.name).join(', ') })
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </p>

          {/* The countdown only reaches a dad who has opened the room. His own
              calendar reaches him on Thursday afternoon, where the decision
              actually gets made. */}
          <a
            href="/api/night.ics"
            className="inline-flex items-center gap-1.5 text-sm"
            data-testid="night-ics"
          >
            <CalendarPlus size={15} aria-hidden="true" />
            {t('n.calendar')}
          </a>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">
          {night === null ? t('n.set') : t('n.change')}
        </h2>
        <NightEditor night={night} onDone={() => {}} />
      </section>
    </div>
  );
}
