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
 * TWO things, and deliberately only two: the night — what this thing is, and
 * when it is — and the conversation, which is what it is for. Everything else
 * the app can do is behind the Menu button and stays there, including what is
 * waiting for HIM: it already lives there and already carries its mark, and a
 * home screen that lists four things is a home screen that ranks none of them.
 *
 * Who is about is not a third block. It sits under the way in, because it is
 * not a separate question — it is the thing that decides whether going in is
 * worth doing now.
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
  answered,
  you,
  connection,
  roster,
  members,
  unseen,
  onGo,
  onWho,
  onNight,
}: {
  night: DadNight | null;
  /**
   * The seq of the most recent line that could change who is coming or what
   * is up for the night.
   *
   * Home is a live screen — the roster on it comes off the socket — but the
   * night was fetched once at mount, so a dad sitting on it watched the list
   * of who is coming go stale while the room said so out loud a foot below.
   * Keyed on the kind of line rather than on any line: a chatty evening is
   * not a reason to re-read the night thirty times.
   */
  answered: number;
  you: string;
  /**
   * Whether the roster below is a fact yet.
   *
   * Home renders the moment the app opens, before the socket has said
   * anything, and an empty roster then is "I do not know" rather than
   * "nobody" — so without this the first screen a dad saw told him his
   * friends were not about, and corrected itself a second later.
   */
  connection: 'connecting' | 'open' | 'reconnecting';
  roster: RosterEntry[];
  members: RosterEntry[];
  unseen: number;
  onGo: () => void;
  onWho: () => void;
  onNight: () => void;
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
  const others = roster.filter((m) => m.memberId !== you);

  return (
    <div className="home" data-testid="home">
      <section className="home-night">
        <h2 className="home-label">{t('n.title')}</h2>
        {night === null ? (
          <>
            {/* The empty state keeps the block's shape and its size. A group
                with no night has the same question as a group with one, and
                a whisper is the wrong way to ask it. */}
            <p className="home-when text-muted">{t('n.none')}</p>
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

            {/* Names, not a count: a man wants to know whether HIS friend is
                coming, which is the thing that actually decides it — and at
                ink rather than muted for the same reason. It was the same
                grey as the section label above it.

                Directly under the when, because the two of them are one fact:
                this is on Thursday and these men are coming. The buttons come
                after, where the actions on this screen belong. */}
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

            {/* The one thing to DO about the night, under the two lines that
                say what it is. */}
            <div className="home-answer">
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

            {items === 0 ? null : (
              <Button look="quiet" className="justify-self-start px-0" onClick={onNight}>
                {t(`home.items_${plural(lang, items)}`, { n: items })}
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            )}
          </>
        )}
      </section>

      {/*
       * The other of the two, and the size of the way in is the point: the
       * night is what this thing IS, and the conversation is what it is for.
       * Home says those two and nothing else — what is waiting for HIM is
       * behind the Menu button, where it already lives and already carries
       * its mark.
       *
       * Who is about sits under the way in rather than in a block of its own.
       * It is not a separate question: it is the thing that decides whether
       * going in is worth doing now.
       */}
      <section className="home-talk">
        <h2 className="home-label">{t('home.talk')}</h2>

        <Button look="primary" className="home-go" onClick={onGo} data-testid="home-go">
          <span>{t('home.go')}</span>
          {unseen > 0 ? (
            <span className="home-new" data-testid="home-new">
              {t(`home.new_${plural(lang, unseen)}`, { n: unseen })}
            </span>
          ) : null}
        </Button>

        {connection !== 'open' && others.length === 0 ? (
          // Nothing to show AND not sure — which is the first second of every
          // cold open. Saying "nobody" before the socket has spoken is the app
          // inventing bad news, and correcting itself a moment later. A
          // reconnect keeps the last roster instead: it was true a moment ago.
          <p className="m-0 text-[0.9375rem] text-muted">…</p>
        ) : others.length === 0 ? (
          <p className="m-0 text-[0.9375rem] text-muted">{t('home.quiet')}</p>
        ) : (
          // Names, not a count. "3 here" is a number a man reads as a quorum;
          // which of his friends is actually about is the thing he opened the
          // app to find out, and it is the same reasoning as the RSVP list
          // above. The faces are who, the words are who as well — one is for
          // the glance and the other is for certainty.
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
            <span className="home-names">{others.map((m) => m.name).join(', ')}</span>
          </button>
        )}
      </section>
    </div>
  );
}
