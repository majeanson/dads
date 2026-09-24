import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import {
  fetchNight,
  fetchPoll,
  setRsvp,
  type Answer as AnswerKind,
  type NightState,
  type PollState,
} from './api';
import { FaceStack } from './Face';
import { plural, useT, weekdayNames } from './i18n';
import { nightAway } from './NightEditor';
import { bestDays } from './Poll';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { buzz } from './buzz';
import { Glasses, Logo } from './Logo';
import { dayNameShort } from '../shared/calendarMonth';
import { currentWindow, stillToCome, type DadNight } from '../shared/dadNight';

/**
 * Four is a table of Jaffre, which is the number that turns a night of talk
 * into a night of cards — and the most important thing that can happen on
 * this screen. Everything below it looked exactly the same as three.
 */
const FULL_TABLE = 4;

/** Celebrated once per evening per phone: the second look is news, not a
 * party. Storage may refuse, and then it celebrates every time — the right
 * way for that to fail. */
function celebrateOnce(occurrence: number): boolean {
  const key = `dads.full.${occurrence}`;
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch {
    // Remembering is a nicety.
  }
  return true;
}

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
  pollPulse,
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
  /** Bumped when the room says somebody marked the calendar. Same rule as
   * `answered`: the KIND of change that can move this screen, never every
   * line said in a chatty evening. */
  pollPulse: number;
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
  const [poll, setPoll] = useState<PollState | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** The full table's moment, playing right now. */
  const [cheer, setCheer] = useState(false);
  /**
   * Pull down to look again. Home reads the night over HTTP, and a phone
   * woken from a pocket may be showing an hour-old answer; a thumb pulling
   * down is how every phone asks for the newest. The mark's glasses slide
   * down its nose as he pulls, and glint while it looks.
   */
  const [pull, setPull] = useState(0);
  const [looking, setLooking] = useState(false);
  const [again, setAgain] = useState(0);
  const pullFrom = useRef<number | null>(null);
  const PULL = 56;
  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    pullFrom.current = e.currentTarget.scrollTop <= 0 ? e.touches[0]!.clientY : null;
  }
  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (pullFrom.current === null) return;
    const dy = e.touches[0]!.clientY - pullFrom.current;
    setPull(dy > 0 ? Math.min(dy * 0.5, PULL * 1.3) : 0);
  }
  function onTouchEnd() {
    if (pull >= PULL && !looking) {
      setLooking(true);
      setAgain((n) => n + 1);
      // Long enough to be seen to look, whatever the network does.
      setTimeout(() => setLooking(false), 700);
    }
    pullFrom.current = null;
    setPull(0);
  }

  /** Bumped when the moment starts and never reset, so the faces remount
   * once to play the wave — and not again when the moment ends. */
  const [cheers, setCheers] = useState(0);

  /**
   * Is there an evening to come, or is the question when the next one is?
   *
   * `night === null` is not the test any more. A night arranged for one
   * evening is still in the group's row the morning after it happened, and a
   * screen that answered "Thursday" the day after Thursday would be the app
   * insisting on a night that is over.
   */
  const upcoming = stillToCome(night, now);

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
  }, [night, answered, again]);

  // The calendar, and only while it is the question being asked. A group with
  // a night on the books has no poll and pays nothing for this.
  useEffect(() => {
    if (upcoming) return;
    let cancelled = false;
    fetchPoll()
      .then((p) => !cancelled && setPoll(p))
      .catch(() => {
        // Same rule as the night: nothing beats a wrong empty calendar.
      });
    return () => {
      cancelled = true;
    };
  }, [upcoming, night, pollPulse, again]);

  // The countdown is the one thing here that goes stale while he looks at it.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function answer(next: AnswerKind) {
    setBusy(true);
    try {
      setState(await setRsvp(next));
    } catch {
      // The room is the record; a failed press leaves this as it was.
    } finally {
      setBusy(false);
    }
  }

  const answers = state?.answers ?? [];
  const mine = answers.find((a) => a.memberId === you) ?? null;
  const coming = answers.filter((a) => a.answer === 'in');
  const might = answers.filter((a) => a.answer === 'maybe');
  const not = answers.filter((a) => a.answer === 'out');
  const items = state?.items.length ?? 0;
  const away = night === null ? null : nightAway(t, lang, night, now);
  const best = poll === null ? [] : bestDays(poll, you, 2);
  const full = coming.length >= FULL_TABLE;
  const occurrence = state?.occurrence ?? null;
  // The moment a table fills — whoever filled it, and whether he was looking
  // when it happened or opens the app later. Once per evening per phone.
  useEffect(() => {
    if (!full || occurrence === null || !celebrateOnce(occurrence)) return;
    setCheer(true);
    setCheers((n) => n + 1);
    buzz(20);
    const done = setTimeout(() => setCheer(false), 1800);
    return () => clearTimeout(done);
  }, [full, occurrence]);

  /** The night is on right now, which is the one moment the mark nods. */
  const live = night !== null && currentWindow(night, now) !== null;
  // Everybody wears his glasses; the ones coming have them come DOWN.
  const faces = [...coming, ...might].map((a) => ({
    memberId: a.memberId,
    shades: a.answer === 'in',
  }));

  return (
    <div
      className="home"
      data-testid="home"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {pull > 0 || looking ? (
        <div
          className="home-pull"
          aria-hidden="true"
          style={{ height: looking ? PULL * 0.8 : pull }}
        >
          <Logo
            size={34}
            hole="var(--bg)"
            motion={looking ? 'glint' : undefined}
            slide={looking ? 0 : Math.min(pull / PULL, 1)}
            className="text-muted"
          />
        </div>
      ) : null}
      {/* Named for a screen reader, where the structure of a page is real, and
          not on the screen, where it would be a word above a line that already
          says what it is. */}
      <section className="home-card" data-cheer={cheer ? 'yes' : undefined}>
        <h2 className="sr-only">{t('n.title')}</h2>

        {!upcoming || night === null ? (
          <>
            {/*
             * No evening to come, so the screen asks the only question that
             * matters: when's the next one. It keeps the card's shape and its
             * size, because a group with nothing on the books has the SAME
             * question as a group with a night — a louder one, if anything —
             * and a whisper is the wrong way to ask it.
             *
             * The days with the most dads on them, and then one button into
             * the calendar. The calendar itself lives in the sheet: a month
             * grid is the right way to answer this and the wrong thing to put
             * on a screen that has to fit a 667px phone with a door under it.
             */}
            <p className="home-none display">{t('p.title')}</p>
            {poll === null ? null : best.length === 0 ? (
              <p className="home-coming" data-testid="home-poll-none">
                {t('p.nobody')}
              </p>
            ) : (
              <p className="home-coming" data-testid="home-poll-best">
                {best
                  .map((d) =>
                    t(`p.tally_in_${plural(lang, d.in)}`, { n: d.in }).concat(
                      ` — ${dayNameShort(lang, d.day)}`,
                    ),
                  )
                  .join(' · ')}
              </p>
            )}
            <Button
              look="primary"
              size="lg"
              className="home-answer h-[clamp(2.75rem,6dvh,3.25rem)]"
              onClick={onNight}
              data-testid="dad-night"
            >
              {t('p.pick_days')}
            </Button>
          </>
        ) : (
          <>
            {/* The day and the hour, stacked, in the biggest type in the app.
                It is the first question a dad has when he picks up his phone
                and it should be answered from across the kitchen. */}
            <p className="home-when" data-testid="home-when">
              <span className="home-day display">{weekdayNames(lang)[night.weekday]}</span>
              {/* Which Thursday, and only for a night that happens once. A
                  standing slot does not need it — every Thursday is the
                  answer — and putting a date under a weekly night would be
                  the card claiming the week after is not on. */}
              {night.date ? (
                <span className="home-date" data-testid="home-date">
                  {dayNameShort(lang, night.date)}
                </span>
              ) : null}
              <span className="home-time display">{night.time}</span>
            </p>

            {/* Only when it is close. "in 5 days" under "Thursday 21:00" is
                the screen saying the same thing twice in a smaller voice. */}
            {/* How far off it is, only when that is news — and a full table
                on the same line, so the news costs the card no height: home
                is measured to fit a 667px phone with ten pixels to spare. */}
            {away === null && !full ? null : (
              <p className="home-meta">
                {away === null ? null : (
                  <span className="home-away" data-testid="home-away">
                    {away}
                  </span>
                )}
                {full ? (
                  <span className="home-full" data-testid="home-full">
                    <Glasses width={24} drop={cheer} />
                    {t('home.full_table')}
                  </span>
                ) : null}
              </p>
            )}

            {/* Names, not a count: a man wants to know whether HIS friend is
                coming, which is the thing that actually decides it. The faces
                answer it at a glance and the names answer it for sure; his own
                face pops into the stack the moment he says he is in. */}
            <div className="home-coming-row">
              {state === null ? (
                // Not known yet: a light across the lenses rather than a
                // claim. The words still say "…".
                <Logo
                  size={30}
                  hole="var(--bg-soft)"
                  motion="glint"
                  className="shrink-0 text-muted"
                />
              ) : (
                <FaceStack
                  // Remounted for the moment, so the shades come down again,
                  // in turn, one face after another.
                  key={cheers}
                  people={faces}
                  size={30}
                  ring="var(--bg-soft)"
                  tint="bg-paper"
                  wave={cheer}
                />
              )}
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
                        might.length > 0
                          ? t('n.maybe_list', { names: might.map((a) => a.name).join(', ') })
                          : null,
                        not.length > 0
                          ? t('n.out_list', { names: not.map((a) => a.name).join(', ') })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
              </p>
            </div>

            {/*
             * One question, three answers, all three on the screen from the
             * start and the one he gave filled in.
             *
             * It used to be two buttons that collapsed into one toggle once he
             * had answered, and the reason was sound: an RSVP is announced by
             * name, so a man who cannot come must not have to say he can and
             * then take it back. Three answers cannot be a toggle — pressing
             * one to cycle through the other two is a button that has to
             * explain itself — so they simply all stay, and pressing another
             * changes his mind. The same rule, kept by different means.
             *
             * No icons here, unlike everywhere else: three controls across a
             * 390px card in French ("Je suis là · Peut-être · Je peux pas")
             * has room for the words or for the glyphs, and the words are the
             * ones that say anything.
             */}
            <div
              className="home-answers"
              role="group"
              aria-label={t('n.title')}
              data-chosen={mine?.answer ?? 'none'}
            >
              {/* The one filled segment, sliding to whichever he chose. It is
                  a picture of the answer, not the answer: each segment still
                  carries aria-pressed, and the words stay where they are. */}
              <span className="home-answers-thumb" aria-hidden="true" />
              <Answer
                answer="in"
                mine={mine?.answer ?? null}
                busy={busy}
                onAnswer={answer}
                testId="home-in"
              />
              <Answer
                answer="maybe"
                mine={mine?.answer ?? null}
                busy={busy}
                onAnswer={answer}
                testId="home-maybe"
              />
              <Answer
                answer="out"
                mine={mine?.answer ?? null}
                busy={busy}
                onAnswer={answer}
                testId="home-out"
              />
            </div>

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
      <div className="home-actions">
        <Button
          look="primary"
          className={cn(
            'home-go h-[clamp(3rem,6.5dvh,4.5rem)] w-full justify-start gap-3.5 rounded-[var(--radius-card)] px-4 text-[1.125rem]',
          )}
          onClick={onGo}
          data-testid="home-go"
        >
          <Logo size={32} hole="var(--accent)" motion={live ? 'live' : 'on'} className="shrink-0" />
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
    </div>
  );
}

/**
 * One of the three answers.
 *
 * Three segments of one control, and a filled thumb that slides under the
 * one he chose — so what he said is on the screen without a word explaining
 * it, and changing his mind is something he can watch happen. The accessible name carries what
 * pressing it would DO — "You're in. Press to say you might make it." is a
 * sentence a screen reader needs and a sighted man does not, because he can
 * see which one is filled.
 */
function Answer({
  answer,
  mine,
  busy,
  onAnswer,
  testId,
}: {
  answer: AnswerKind;
  mine: AnswerKind | null;
  busy: boolean;
  onAnswer: (answer: AnswerKind) => void;
  testId: string;
}) {
  const { t } = useT();
  const chosen = mine === answer;
  const label = answer === 'in' ? t('n.im_in') : answer === 'maybe' ? t('n.maybe') : t('n.cant');

  return (
    <Button
      look="quiet"
      size="lg"
      className={cn(
        'home-answer relative h-[clamp(2.75rem,6dvh,3.25rem)] px-1 text-base font-medium',
        'rounded-[calc(var(--radius-control)-0.25rem)] transition-colors duration-200',
        chosen
          ? answer === 'out'
            ? 'text-paper hover:text-paper'
            : 'text-on-accent hover:text-on-accent'
          : 'text-ink',
      )}
      disabled={busy}
      aria-pressed={chosen}
      onClick={() => void onAnswer(answer)}
      data-testid={testId}
      data-mine={chosen ? 'yes' : 'no'}
    >
      {label}
    </Button>
  );
}
