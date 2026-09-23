import { CalendarClock, ChevronLeft, Menu as MenuIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RosterEntry } from '../shared/protocol';
import { JoinCall } from './CallBar';
import { FaceStack } from './Face';
import { Logo } from './Logo';
import type { CallState } from './useCall';
import { useT } from './i18n';
import { Button } from './ui/Button';

/**
 * The app bar, in two shapes.
 *
 * On HOME it is the group's name and the head-count and nothing else. The
 * menu is on home itself, under the night and the door, and the call is
 * joined from the conversation — so there is nothing for the bar to hold a
 * button for.
 *
 * In the CONVERSATION it is ONE row that never wraps (2026-09-22): the way
 * back, the faces of who is here and the count, the night in as few
 * characters as it can be said ("Thu 21:00"), and the call and the menu. It
 * was two and sometimes three rows — "dad night Thursdays at / 21:00" folded
 * under the count on every phone — and each of those rows was a row of
 * conversation it cost. The group's name is the title of that row: which
 * room he is talking in, with the faces beside it for who is here.
 *
 * Either way it must be structurally incapable of overflowing. The name and
 * the count give way (`min-width: 0` on the left, `shrink-0` on the actions),
 * because an over-long header does not wrap — it makes the whole PAGE wider,
 * and the composer ends up half off the right-hand side of a phone.
 */
export function RoomHeader({
  groupName,
  view,
  connection,
  here,
  roster,
  faceOf,
  soon,
  callState,
  waiting,
  onHome,
  onWho,
  onNight,
  onMenu,
  onJoinCall,
}: {
  groupName: string;
  view: 'home' | 'talk';
  connection: 'connecting' | 'open' | 'reconnecting';
  here: number;
  /** Who is connected, for the faces beside the count. */
  roster: RosterEntry[];
  faceOf: (memberId: string) => number | undefined;
  /** The night, short: "Thu 21:00", a countdown when close, null with none. */
  soon: string | null;
  callState: CallState;
  /** A question is waiting for him: the one thing in this menu that can. */
  waiting: boolean;
  onHome: () => void;
  onWho: () => void;
  onNight: () => void;
  onMenu: () => void;
  onJoinCall: () => void;
}) {
  const { t } = useT();
  const slim = view === 'talk';

  /**
   * Who has just come in, for a moment. Presence has a heartbeat without a
   * line in the conversation: his face pops into the stack with a ring going
   * out from it. The roster he found on arriving is not news, so the first
   * one this screen sees is the baseline.
   */
  const known = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<string[]>([]);
  useEffect(() => {
    const ids = roster.map((r) => r.memberId);
    if (known.current === null) {
      if (connection === 'open') known.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !known.current!.has(id));
    known.current = new Set(ids);
    if (fresh.length === 0) return;
    setArrived((a) => [...a, ...fresh]);
    // Not cleared with the effect: a second dad arriving inside the moment
    // re-runs it, and cancelling the first one's timer would leave his ring
    // on for good.
    setTimeout(() => setArrived((a) => a.filter((id) => !fresh.includes(id))), 1600);
  }, [roster, connection]);

  return (
    <header className={`room-head border-b border-line ${slim ? 'pb-2' : 'pb-2.5'}`}>
      {/* A real back button, first in the bar, the way every app on a phone
          does it. It was the group's name with a chevron, which is the
          convention on a desktop and something nobody finds on a phone. */}
      {slim ? (
        <Button
          size="icon"
          look="quiet"
          className="-ml-1 shrink-0"
          onClick={onHome}
          aria-label={t('home.title')}
          data-testid="go-home"
        >
          <ChevronLeft size={24} aria-hidden="true" />
          <span className="sr-only">{t('home.title')}</span>
        </Button>
      ) : null}

      {slim ? (
        <>
          {/* The room's name, where the count used to be (2026-09-23): he
              should know which room he is talking in. The name has the row;
              the faces (who is here) and the night go under it, small, so a
              name like "Throwback daddies" is not cut on a 390px phone. */}
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-lg leading-tight text-ink">{groupName}</h1>
            <div className="flex min-w-0 items-center gap-2.5">
              {/* The faces ARE the head-count here. The control is laid over them,
                  the full size of them and a thumb's margin more, and it is still
                  called "2 here" — which is what a screen reader says and what
                  the tests read. Not wrapped round them: a face's initials are
                  text and would become part of its name. */}
              <span className="relative shrink-0">
                {connection === 'open' ? (
                  <FaceStack
                    people={roster.map((r) => ({
                      memberId: r.memberId,
                      name: r.name,
                      version: faceOf(r.memberId),
                      arrived: arrived.includes(r.memberId),
                    }))}
                    size={24}
                    max={4}
                    ring="var(--bg)"
                  />
                ) : (
                  <Logo size={24} hole="var(--bg)" motion="glint" className="shrink-0 text-muted" />
                )}
                <button
                  type="button"
                  className="absolute -inset-2.5 cursor-pointer rounded-full"
                  data-testid="connection"
                  onClick={onWho}
                >
                  <span className="sr-only">
                    {connection === 'open'
                      ? t('room.here', { n: here })
                      : connection === 'connecting'
                        ? t('room.opening')
                        : t('room.reconnecting')}
                  </span>
                </button>
              </span>
              {soon === null ? null : (
                <button
                  type="button"
                  className="count-in min-h-7 min-w-0 gap-1 text-sm text-muted"
                  data-testid="night-soon"
                  onClick={onNight}
                >
                  <CalendarClock size={14} aria-hidden="true" className="shrink-0" />
                  <span className="sr-only">{t('n.title')}: </span>
                  <span className="truncate">{soon}</span>
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="min-w-0">
          <h1 className="display truncate text-xl text-ink">{groupName}</h1>
          <p className="flex min-w-0 items-center gap-2 text-[1.0625rem] text-ink">
            {/* The faces are the count, drawn: the words beside them are the
              control and the thing a test and a screen reader read. Outside the
              button on purpose — initials inside it would be part of its name. */}
            {connection === 'open' ? (
              <span className="shrink-0 cursor-pointer" onClick={onWho} aria-hidden="true">
                <FaceStack
                  people={roster.map((r) => ({
                    memberId: r.memberId,
                    name: r.name,
                    version: faceOf(r.memberId),
                    arrived: arrived.includes(r.memberId),
                  }))}
                  size={26}
                  max={4}
                  ring="var(--bg)"
                />
              </span>
            ) : (
              // Opening or coming back: a light across the lenses until the
              // room answers.
              <Logo size={24} hole="var(--bg)" motion="glint" className="shrink-0 text-muted" />
            )}
            {/* The count is also the door to the roster and to who has been
              about. A button, because it does something — but not a blue
              underlined link, which is three times louder than a group of five
              men needs its own head-count to be. */}
            <button
              type="button"
              className="count-in shrink-0"
              data-testid="connection"
              onClick={onWho}
            >
              {connection === 'open'
                ? t('room.here', { n: here })
                : connection === 'connecting'
                  ? t('room.opening')
                  : t('room.reconnecting')}
            </button>
          </p>
        </div>
      )}

      {/* Only in the conversation. On home the menu is the screen and the
          call is a thing you join from beside the talk. */}
      {slim ? (
        <span className="head-actions">
          <JoinCall state={callState} onJoin={onJoinCall} />
          <Button size="icon" onClick={onMenu} aria-label={t('room.menu')} className="relative">
            <MenuIcon size={22} aria-hidden="true" />
            <span className="sr-only">{t('room.menu')}</span>
            {/* The one place a dot is right: the words are behind the button
                it sits on, and the menu says which thing in words. */}
            {waiting ? (
              <span
                className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-accent"
                data-testid="mark-menu"
                aria-hidden="true"
              />
            ) : null}
            {waiting ? <span className="sr-only">{t('room.waiting')}</span> : null}
          </Button>
        </span>
      ) : null}
    </header>
  );
}
