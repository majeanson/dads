import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import {
  fetchNight,
  fetchPoll,
  setRsvp,
  type Answer as AnswerKind,
  type NightState,
  type PollState,
} from './api';
import { Answers } from './Answers';
import { FaceStack } from './Face';
import { plural, useT, weekdayNames } from './i18n';
import { nightAway } from './NightEditor';
import { NextDays } from './NextDays';
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
  const lookTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(lookTimer.current), []);
  function onTouchEnd() {
    if (pull >= PULL && !looking) {
      setLooking(true);
      setAgain((n) => n + 1);
      // Long enough to be seen to look, whatever the network does.
      lookTimer.current = setTimeout(() => setLooking(false), 700);
    }
    onTouchCancel();
  }
  /** A pull the phone took back — the back-edge swipe, the notification
   * shade — ends with no touchend, and left the mark hanging half-pulled. */
  function onTouchCancel() {
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
      onTouchCancel={onTouchCancel}
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
            {poll === null ? null : <NextDays poll={poll} you={you} />}
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
                is measured to fit a 667px phone with ten pixels to spare.
                With the night further off there is no line to share, and a
                row of its own put home past the bottom of that phone; the
                news then sits at the head of the names, which wrap anyway. */}
            {away === null ? null : (
              <p className="home-meta">
                <span className="home-away" data-testid="home-away">
                  {away}
                </span>
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
                {state === null ? (
                  // Not "nobody has said yet" — it has not been asked yet.
                  '…'
                ) : answers.length === 0 ? (
                  t('n.nobody_yet')
                ) : (
                  <>
                    {/* With the news and no countdown line to share, "Full
                        table" takes the place of "In" rather than a row or a
                        phrase of its own: four names already wrap, and a
                        phrase in front of them was one more line on a card
                        with ten pixels to spare. */}
                    {coming.length > 0 && full && away === null ? (
                      <>
                        <span className="home-full" data-testid="home-full">
                          <Glasses width={24} drop={cheer} />
                          {t('home.full_table')}
                        </span>
                        {t('home.full_join')}
                        {coming.map((a) => a.name).join(', ')}
                      </>
                    ) : coming.length > 0 ? (
                      t('n.in_list', { names: coming.map((a) => a.name).join(', ') })
                    ) : null}
                    {[
                      coming.length > 0 ? '' : null,
                      might.length > 0
                        ? t('n.maybe_list', { names: might.map((a) => a.name).join(', ') })
                        : null,
                      not.length > 0
                        ? t('n.out_list', { names: not.map((a) => a.name).join(', ') })
                        : null,
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </>
                )}
              </p>
            </div>

            {/* One question, three answers, all three on the screen from the
                start and the one he gave filled in. It used to be two buttons
                that collapsed into one toggle once he had answered; the
                reason for that is kept by the control itself (`Answers`). */}
            <Answers
              mine={mine?.answer ?? null}
              busy={busy}
              onAnswer={answer}
              ids={{ in: 'home-in', maybe: 'home-maybe', out: 'home-out' }}
            />

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
          arrow on the right are what make it a way IN rather than a choice.

          Since 2026-09-25 it is the only thing under the card: the rows that
          sat below it went behind the conversation's Menu and Settings went
          to the header's corner. So it is big — a door, not a row. */}
      <div className="home-actions">
        {/* A speech bubble, because that is what the door is for: the face
            big on the left, sitting up out of the top edge, the words in
            the display face, and a tail at the bottom where a bubble points
            back at whoever is talking. The only speech bubble in the app. */}
        <Button
          look="primary"
          className={cn(
            'home-go h-[clamp(4.5rem,11dvh,6.5rem)] w-full justify-start gap-3 mb-3 rounded-[2.25rem]! rounded-bl-[0.5rem]! pr-6 pl-[clamp(6rem,15dvh,8rem)]',
            'text-[clamp(1.625rem,4.25dvh,2.25rem)]',
          )}
          onClick={onGo}
          data-testid="home-go"
        >
          <span className="home-go-face" aria-hidden="true">
            <Logo size={96} hole="var(--accent)" motion={live ? 'live' : 'on'} />
          </span>
          <span className="display min-w-0 truncate">{t('home.go')}</span>
          {unseen > 0 ? (
            <span className="home-new ml-auto font-normal" data-testid="home-new">
              {t(`home.new_${plural(lang, unseen)}`, { n: unseen })}
            </span>
          ) : null}
          <ArrowRight
            size={30}
            aria-hidden="true"
            className={cn('shrink-0', unseen > 0 ? '' : 'ml-auto')}
          />
        </Button>
      </div>
    </div>
  );
}
