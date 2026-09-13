import { ChevronLeft, Menu as MenuIcon } from 'lucide-react';
import { JoinCall } from './CallBar';
import type { CallState } from './useCall';
import { useT } from './i18n';
import { Button } from './ui/Button';

/**
 * The app bar, and it must be structurally incapable of overflowing.
 *
 * The name gives way (`min-width: 0` on the left, `shrink-0` on the actions),
 * because an over-long header does not wrap — it makes the whole PAGE wider,
 * and the composer ends up half off the right-hand side of a phone. A
 * breakpoint cannot be trusted with this either: "Join the call" fits a 390px
 * phone and "Embarque dans l'appel" does not.
 */
export function RoomHeader({
  groupName,
  view,
  connection,
  here,
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
  /** The countdown, but only inside 24 hours. Null the rest of the week. */
  soon: string | null;
  callState: CallState;
  /** Something is waiting for HIM — a question, a week to fill in. */
  waiting: boolean;
  onHome: () => void;
  onWho: () => void;
  onNight: () => void;
  onMenu: () => void;
  onJoinCall: () => void;
}) {
  const { t } = useT();

  return (
    <header className="room-head border-b border-line pb-2.5">
      {/* A real back button, first in the bar, the way every app on a phone
          does it. It was the group's name with a chevron, which is the
          convention on a desktop and something nobody finds on a phone. */}
      {view === 'talk' ? (
        <Button
          size="icon"
          look="quiet"
          className="-ml-1 shrink-0"
          onClick={onHome}
          aria-label={t('home.title')}
          data-testid="go-home"
        >
          <ChevronLeft size={20} aria-hidden="true" />
          <span className="sr-only">{t('home.title')}</span>
        </Button>
      ) : null}

      <div className="min-w-0">
        <h1 className="display truncate text-base text-muted">{groupName}</h1>
        {/* The count is also the door to the roster and to who has been about.
            A button, because it does something — but not a blue underlined
            link, which is three times louder than a group of five men needs
            its own head-count to be. */}
        <p className="text-[0.9375rem] text-ink">
          <button type="button" className="count-in" data-testid="connection" onClick={onWho}>
            {connection === 'open'
              ? t('room.here', { n: here })
              : connection === 'connecting'
                ? t('room.opening')
                : t('room.reconnecting')}
          </button>
          {/* Not on home, where the night is the first thing on the screen and
              four times the size. A header that repeats what is an inch below
              it is the app saying something twice. */}
          {soon === null || view === 'home' ? null : (
            <span className="max-[30rem]:block max-[30rem]:pt-0.5">
              <span className="max-[30rem]:hidden"> · </span>
              <button
                type="button"
                className="count-in max-[30rem]:block max-[30rem]:text-left"
                data-testid="night-soon"
                onClick={onNight}
              >
                {soon}
              </button>
            </span>
          )}
        </p>
      </div>

      <span className="head-actions">
        <JoinCall state={callState} onJoin={onJoinCall} />
        <Button
          size="sm"
          onClick={onMenu}
          aria-label={t('room.menu')}
          // A thumb's square on a phone: this and the call are the two things
          // pressed most, and they sit under the notch.
          className="relative max-[48rem]:h-10 max-[48rem]:w-10 max-[48rem]:px-0"
        >
          <MenuIcon size={16} aria-hidden="true" />
          <span className="max-[48rem]:sr-only">{t('room.menu')}</span>
          {waiting ? (
            <span
              className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent"
              data-testid="mark-menu"
              aria-hidden="true"
            />
          ) : null}
          {waiting ? <span className="sr-only">{t('room.waiting')}</span> : null}
        </Button>
      </span>
    </header>
  );
}
