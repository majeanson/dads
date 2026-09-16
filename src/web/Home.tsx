import { ArrowRight, Check, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchNight, setRsvp, type NightState } from './api';
import { plural, useT, weekdayNames } from './i18n';
import { Logo } from './Logo';
import { nightAway } from './NightEditor';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import type { DadNight } from '../shared/dadNight';

/**
 * Where the app opens, and it asks ONE question.
 *
 * Are you coming on Thursday. That is the whole screen: the day and the hour
 * in the biggest type in the app, how far off it is, who has said yes, and one
 * button to answer with — then a door into the conversation, because talking
 * is what the night is for and a man who only came to talk should lose one
 * tap, not four.
 *
 * Nothing else. Not who is about (the header counts them and the roster is one
 * tap in), not what is waiting for him (the Menu button carries that, in
 * words, and has since home stopped listing it). A home screen that asks two
 * questions gets neither answered.
 *
 * The socket is already open behind this — the room hook lives above both
 * screens — so going in is instant rather than a reconnect.
 */
export function Home({
  night,
  answered,
  you,
  unseen,
  onGo,
  onNight,
  menu,
}: {
  night: DadNight | null;
  /**
   * The seq of the most recent line that could change who is coming or what
   * is up for the night.
   *
   * Home is a live screen, but the night is fetched rather than pushed — so a
   * dad sitting on it watched the list of who is coming go stale while the
   * room said so out loud a foot below. Keyed on the KIND of line: a chatty
   * evening is not a reason to re-read the night thirty times.
   */
  answered: number;
  you: string;
  unseen: number;
  onGo: () => void;
  onNight: () => void;
  /**
   * The rest of the app, as rows under the door.
   *
   * A slot rather than the menu's props: home knows what the night is and
   * where the door goes, and nothing about what is behind the other rooms.
   */
  menu: ReactNode;
}) {
  const { t, lang } = useT();
  const [state, setState] = useState<NightState | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    fetchNight()
      .then((s) => !cancelled && setState(s))
      .catch(() => {
        // The night is still on the screen from the group's own slot; only
        // who is coming is missing, and a wrong list is worse than none.
      });
    return () => {
      cancelled = true;
    };
  }, [night, answered]);

  // The countdown is the one thing here that goes stale while he looks at it.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function answer(coming: boolean) {
    setBusy(true);
    try {
      setState(await setRsvp(coming));
    } catch {
      // The room is the record; a failed press leaves this as it was.
    } finally {
      setBusy(false);
    }
  }

  const answers = state?.answers ?? [];
  const mine = answers.find((a) => a.memberId === you) ?? null;
  const coming = answers.filter((a) => a.coming);
  const not = answers.filter((a) => !a.coming);
  const items = state?.items.length ?? 0;
  const away = night === null ? null : nightAway(t, lang, night, now);

  return (
    <div className="home" data-testid="home">
      {/* Named for a screen reader, where the structure of a page is real, and
          not on the screen, where it would be a word above a line that already
          says what it is. */}
      <section className="home-card">
        <h2 className="sr-only">{t('n.title')}</h2>

        {night === null ? (
          <>
            {/* The empty state keeps the card's shape and its size. A group
                with no night has the same question as a group with one, and a
                whisper is the wrong way to ask it. */}
            <p className="home-none display">{t('n.none')}</p>
            <Button
              look="primary"
              size="lg"
              className="home-answer h-[clamp(2.75rem,6dvh,3.25rem)]"
              onClick={onNight}
              data-testid="dad-night"
            >
              {t('n.set')}
            </Button>
          </>
        ) : (
          <>
            {/* The day and the hour, stacked, in the biggest type in the app.
                It is the first question a dad has when he picks up his phone
                and it should be answered from across the kitchen. */}
            <p className="home-when" data-testid="home-when">
              <span className="home-day display">{weekdayNames(lang)[night.weekday]}</span>
              <span className="home-time display">{night.time}</span>
            </p>

            {/* Only when it is close. "in 5 days" under "Thursday 21:00" is
                the screen saying the same thing twice in a smaller voice. */}
            {away === null ? null : (
              <p className="home-away" data-testid="home-away">
                {away}
              </p>
            )}

            {/* Names, not a count: a man wants to know whether HIS friend is
                coming, which is the thing that actually decides it. */}
            <p className="home-coming" data-testid="home-who-coming">
              {state === null
                ? // Not "nobody has said yet" — it has not been asked yet.
                  '…'
                : answers.length === 0
                  ? t('n.nobody_yet')
                  : [
                      coming.length > 0
                        ? t('n.in_list', { names: coming.map((a) => a.name).join(', ') })
                        : null,
                      not.length > 0
                        ? t('n.out_list', { names: not.map((a) => a.name).join(', ') })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
            </p>

            {/*
             * One question, one answer.
             *
             * Until he has said, both are offered: a man who cannot come must
             * not have to say he can — the room announces an RSVP by name, and
             * saying yes then no would put two lines in the conversation about
             * one evening.
             *
             * Once he has answered it is a single button showing what he said,
             * and pressing it changes his mind. What the press does is in the
             * accessible name rather than on the screen, because a label
             * explaining a button is a button that needed explaining.
             */}
            {mine === null ? (
              <div className="home-answers">
                <Button
                  look="primary"
                  size="lg"
                  className="home-answer h-[clamp(2.75rem,6dvh,3.25rem)]"
                  disabled={busy}
                  onClick={() => void answer(true)}
                  data-testid="home-in"
                >
                  <Check size={18} aria-hidden="true" />
                  {t('n.im_in')}
                </Button>
                <Button
                  size="lg"
                  className="home-answer h-[clamp(2.75rem,6dvh,3.25rem)]"
                  disabled={busy}
                  onClick={() => void answer(false)}
                  data-testid="home-out"
                >
                  <X size={18} aria-hidden="true" />
                  {t('n.cant')}
                </Button>
              </div>
            ) : (
              <Button
                look={mine.coming ? 'primary' : 'plain'}
                size="lg"
                className="home-answer h-[clamp(2.75rem,6dvh,3.25rem)]"
                disabled={busy}
                onClick={() => void answer(!mine.coming)}
                aria-label={mine.coming ? t('n.youre_in_change') : t('n.youre_out_change')}
                data-testid={mine.coming ? 'home-in' : 'home-out'}
                data-coming={mine.coming ? 'yes' : 'no'}
              >
                {mine.coming ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <X size={18} aria-hidden="true" />
                )}
                <span aria-hidden="true">{mine.coming ? t('n.youre_in') : t('n.youre_out')}</span>
              </Button>
            )}

            {/* The way into the rest of the night — what to get into, the
                calendar, changing it. Always here, because the card is the
                only place the night lives on this screen: there is no Dad
                night row under it saying the same thing twice. */}
            <Button
              look="quiet"
              className="home-items h-10"
              onClick={onNight}
              data-testid="dad-night"
            >
              {items === 0
                ? t('home.night_more')
                : t(`home.items_${plural(lang, items)}`, { n: items })}
              <ArrowRight size={15} aria-hidden="true" />
            </Button>
          </>
        )}
      </section>

      {/* The door. Talking is what the night is for, so it is a whole control
          of its own — and it says how many lines are waiting, so the man who
          only came to talk spends one tap and knows why.

          It carries the app's own mark, which nothing else on the screen does:
          the card's answers are filled the same way, and a door that was one
          more filled bar read as one more answer. The mark on the left and the
          arrow on the right are what make it a way IN rather than a choice —
          the same shape as the rows under it, taller, and the only one filled. */}
      <Button
        look="primary"
        className={cn(
          'home-go h-[clamp(3rem,6.5dvh,4.5rem)] w-full justify-start gap-3.5 rounded-[var(--radius-card)] px-4 text-[1.125rem]',
        )}
        onClick={onGo}
        data-testid="home-go"
      >
        <Logo size={32} hole="var(--accent)" className="shrink-0" />
        <span>{t('home.go')}</span>
        {unseen > 0 ? (
          <span className="home-new ml-auto text-sm font-normal" data-testid="home-new">
            {t(`home.new_${plural(lang, unseen)}`, { n: unseen })}
          </span>
        ) : null}
        <ArrowRight
          size={22}
          aria-hidden="true"
          className={cn('shrink-0', unseen > 0 ? '' : 'ml-auto')}
        />
      </Button>

      {/* Everything else, in what used to be empty space below the door. The
          same rows the conversation keeps behind its Menu button, minus the
          table, which only makes sense beside a conversation. */}
      {menu}
    </div>
  );
}
