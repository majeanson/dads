import { ArrowRight, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchNight, setRsvp, type NightState } from './api';
import { Face } from './Face';
import { plural, useT } from './i18n';
import { nightDetail } from './NightEditor';
import { Button } from './ui/Button';
import type { DadNight } from '../shared/dadNight';
import type { RosterEntry } from '../shared/protocol';

/**
 * Where the app opens.
 *
 * The room is still the point of this thing, and everything here is in
 * service of getting a man into it — but four of the five questions a dad has
 * when he picks up his phone are not "what was said": they are when the night
 * is, whether anyone else is about, whether he has answered yet, and whether
 * anything is waiting for him. Those used to be a countdown that showed up
 * inside 24 hours and three items behind a menu.
 *
 * It is one tap from here into the conversation, and the tap says how many
 * lines are waiting, so the man who only came to talk loses a second and the
 * man who came to find out when Thursday is loses nothing.
 *
 * The socket is already open behind this — the room hook lives above both
 * screens — so "who is here" is live rather than polled, and going in is
 * instant rather than a reconnect.
 */
export function Home({
  night,
  you,
  roster,
  members,
  unseen,
  todo,
  rooms,
  onGo,
  onWho,
  onNight,
  onPrompts,
  onBoard,
}: {
  night: DadNight | null;
  you: string;
  roster: RosterEntry[];
  members: RosterEntry[];
  unseen: number;
  todo: { prompt: boolean; board: boolean };
  rooms: { questions: boolean; week: boolean };
  onGo: () => void;
  onWho: () => void;
  onNight: () => void;
  onPrompts: () => void;
  onBoard: () => void;
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
  }, [night]);

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
  const others = roster.filter((m) => m.memberId !== you);
  const waiting = (todo.prompt && rooms.questions) || (todo.board && rooms.week);

  return (
    <div className="home" data-testid="home">
      <section className="home-night">
        <h2 className="home-label">{t('n.title')}</h2>
        {night === null ? (
          <>
            <p className="m-0 text-[0.9375rem] text-muted">{t('n.none')}</p>
            <Button className="justify-self-start" onClick={onNight}>
              {t('n.set')}
            </Button>
          </>
        ) : (
          <>
            {/* The whole answer to "when is it again", in one line a man reads
                without tapping anything. */}
            <p className="home-when" data-testid="home-when">
              {nightDetail(t, lang, night, now)}
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                look={mine?.coming === true ? 'primary' : 'plain'}
                disabled={busy}
                onClick={() => void answer(true)}
                data-testid="home-in"
              >
                <Check size={15} aria-hidden="true" />
                {t('n.im_in')}
              </Button>
              <Button
                look={mine?.coming === false ? 'danger' : 'plain'}
                disabled={busy}
                onClick={() => void answer(false)}
                data-testid="home-out"
              >
                <X size={15} aria-hidden="true" />
                {t('n.cant')}
              </Button>
            </div>

            {/* Names, not a count: a man wants to know whether HIS friend is
                coming, which is the thing that actually decides it. */}
            <p className="m-0 text-[0.9375rem] text-muted" data-testid="home-who-coming">
              {answers.length === 0
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

            {items === 0 ? null : (
              <Button look="quiet" className="justify-self-start px-0" onClick={onNight}>
                {t(`home.items_${plural(lang, items)}`, { n: items })}
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            )}
          </>
        )}
      </section>

      {/* The way in, and the size of it is the point: this is what the app is
          for and everything above is what a man checks on the way past. */}
      <Button look="primary" className="home-go" onClick={onGo} data-testid="home-go">
        <span>{t('home.go')}</span>
        {unseen > 0 ? (
          <span className="home-new" data-testid="home-new">
            {t(`home.new_${plural(lang, unseen)}`, { n: unseen })}
          </span>
        ) : null}
      </Button>

      <section className="home-here">
        <h2 className="home-label">{t('here.title')}</h2>
        {others.length === 0 ? (
          <p className="m-0 text-[0.9375rem] text-muted">{t('home.quiet')}</p>
        ) : (
          <button type="button" className="home-faces" onClick={onWho} data-testid="home-faces">
            <span className="home-face-row">
              {others.slice(0, 6).map((m) => (
                <Face
                  key={m.memberId}
                  memberId={m.memberId}
                  name={m.name}
                  version={members.find((x) => x.memberId === m.memberId)?.face}
                  size={32}
                />
              ))}
            </span>
            <span>{t('room.here', { n: roster.length })}</span>
          </button>
        )}
      </section>

      {/* Only ever about HIM. Something somebody else has not done is not a
          thing to put on a man's home screen. */}
      {waiting ? (
        <section className="home-waiting" data-testid="home-waiting">
          {todo.prompt && rooms.questions ? (
            <Button block onClick={onPrompts} data-testid="home-prompt">
              {t('menu.questions')}
              <span className="ml-auto text-sm font-normal text-accent">
                {t('menu.prompt_waiting')}
              </span>
            </Button>
          ) : null}
          {todo.board && rooms.week ? (
            <Button block onClick={onBoard} data-testid="home-board">
              {t('menu.week')}
              <span className="ml-auto text-sm font-normal text-accent">
                {t('menu.board_waiting')}
              </span>
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
